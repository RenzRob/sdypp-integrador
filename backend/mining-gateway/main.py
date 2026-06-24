"""mining-gateway — único borde público entre el cluster propio (GKE) y el del profe.

Modelo PULL: el TrP (cluster del profe, sin entrypoint público) hace solo llamadas
salientes a este gateway. El gateway nunca llama al TrP.

  Ida:    NCT → queue:mining (task.global) → [gateway] ← GET /next-task ← TrP
  Vuelta: TrP → POST /result → [gateway] → queue:nct_results → NCT

Autenticación: mTLS, verificada por el Ingress nginx (annotations auth-tls-*).
Las llamadas que llegan acá ya vienen de un cliente con cert firmado por la CA.
El RabbitMQ nunca se expone.
"""

import os
import time
import json
import logging

import pika
from fastapi import FastAPI, Response

logging.basicConfig(level=logging.INFO, format="%(asctime)s [GATEWAY] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
POLL_WAIT = float(os.environ.get("POLL_WAIT", "20"))  # long-poll: cuánto espera /next-task


class Gateway:
    def _connect_rabbitmq(self):
        params = pika.URLParameters(RABBITMQ_URL)
        params.heartbeat = 60
        params.blocked_connection_timeout = 300
        for attempt in range(10):
            try:
                conn = pika.BlockingConnection(params)
                return conn
            except Exception as e:
                logger.warning(f"RabbitMQ connection attempt {attempt + 1}/10 failed: {e}")
                time.sleep(3)
        raise RuntimeError("Could not connect to RabbitMQ after 10 attempts")

    def _setup(self, ch):
        ch.exchange_declare(exchange="mining", exchange_type="direct", durable=True)
        ch.exchange_declare(exchange="nct_results", exchange_type="direct", durable=True)
        ch.queue_declare(queue="mining_gateway_q", durable=True)
        ch.queue_bind(queue="mining_gateway_q", exchange="mining", routing_key="task.global")

    def next_task(self):
        """Long-poll: devuelve una tarea de la cola mining o None si no hay."""
        conn = self._connect_rabbitmq()
        try:
            ch = conn.channel()
            self._setup(ch)
            deadline = time.time() + POLL_WAIT
            while time.time() < deadline:
                # auto_ack=True → at-most-once: si el TrP muere mientras mina, ese
                # bloque se pierde. Aceptable para el TP; simple y thread-safe.
                method, _props, body = ch.basic_get(queue="mining_gateway_q", auto_ack=True)
                if method:
                    return body
                time.sleep(1)
            return None
        finally:
            conn.close()

    def publish_nct_result(self, nct_result: dict):
        conn = self._connect_rabbitmq()
        try:
            ch = conn.channel()
            self._setup(ch)
            ch.basic_publish(
                exchange="nct_results",
                routing_key="nct.result",
                body=json.dumps(nct_result),
                properties=pika.BasicProperties(delivery_mode=2),
            )
        finally:
            conn.close()


gateway = Gateway()
app = FastAPI()


@app.get("/ping")
def ping():
    return {"status": "ok", "service": "mining-gateway"}


@app.get("/next-task")
def next_task():
    # mTLS verificado por el Ingress: solo el TrP con cert válido llega acá.
    body = gateway.next_task()
    if body is None:
        return Response(status_code=204)
    return Response(content=body, media_type="application/json")


@app.post("/result")
def result(nct_result: dict):
    task_id = nct_result.get("task_id")
    gateway.publish_nct_result(nct_result)
    logger.info(f"Result for task {task_id} published to nct_results")
    return {"status": "accepted"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
