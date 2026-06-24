"""mining-gateway — puente entre el cluster propio (GKE) y el cluster del profe.

Vive en el MISMO cluster que el NCT. Único borde controlado entre clusters:

  Ida:    NCT → queue:mining (task.global) → [gateway] → HTTPS+mTLS → TrP /mine
  Vuelta: TrP → HTTPS+mTLS → [gateway] /result → queue:nct_results → NCT

Autenticación entre clusters: mTLS. La verificación del cert de cliente la hace
el Ingress nginx (annotations auth-tls-*), así que las llamadas que llegan acá ya
están autenticadas. Para llamar al TrP, el gateway presenta su propio cert.
El RabbitMQ nunca se expone.
"""

import os
import json
import time
import logging
import threading
from contextlib import asynccontextmanager

import pika
import requests
from fastapi import FastAPI

logging.basicConfig(level=logging.INFO, format="%(asctime)s [GATEWAY] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
TRP_URL = os.environ.get("TRP_URL", "http://localhost:9000").rstrip("/")
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT", "10"))

# mTLS: cert+key de cliente propio y CA para verificar al TrP.
CLIENT_CERT = os.environ.get("CLIENT_CERT_PATH", "/certs/tls.crt")
CLIENT_KEY = os.environ.get("CLIENT_KEY_PATH", "/certs/tls.key")
CA_CERT = os.environ.get("CA_CERT_PATH", "/ca/ca.crt")


class Gateway:
    def _connect_rabbitmq(self):
        params = pika.URLParameters(RABBITMQ_URL)
        params.heartbeat = 60
        params.blocked_connection_timeout = 300
        for attempt in range(10):
            try:
                conn = pika.BlockingConnection(params)
                logger.info("RabbitMQ connected")
                return conn
            except Exception as e:
                logger.warning(f"RabbitMQ connection attempt {attempt + 1}/10 failed: {e}")
                time.sleep(3)
        raise RuntimeError("Could not connect to RabbitMQ after 10 attempts")

    def _setup_exchanges(self, ch):
        ch.exchange_declare(exchange="mining", exchange_type="direct", durable=True)
        ch.exchange_declare(exchange="nct_results", exchange_type="direct", durable=True)

    # ── Ida: consume mining task del NCT y lo reenvía por HTTPS+mTLS al TrP ─────

    def on_task(self, ch, method, properties, body):
        try:
            task = json.loads(body)
            task_id = task.get("task_id")
            resp = requests.post(
                f"{TRP_URL}/mine",
                data=body,
                headers={"Content-Type": "application/json"},
                cert=(CLIENT_CERT, CLIENT_KEY),
                verify=CA_CERT,
                timeout=HTTP_TIMEOUT,
            )
            if resp.status_code in (200, 202):
                logger.info(f"Task {task_id} forwarded to TrP ({resp.status_code})")
                ch.basic_ack(delivery_tag=method.delivery_tag)
            else:
                logger.error(f"TrP rejected task {task_id}: {resp.status_code} {resp.text}")
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
        except Exception as e:
            logger.error(f"Failed to forward task to TrP: {e}")
            try:
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=True)
            except Exception:
                pass

    def consume_tasks(self):
        """Loop bloqueante con reconexión automática."""
        while True:
            try:
                conn = self._connect_rabbitmq()
                ch = conn.channel()
                self._setup_exchanges(ch)
                ch.queue_declare(queue="mining_gateway_q", durable=True)
                ch.queue_bind(queue="mining_gateway_q", exchange="mining", routing_key="task.global")
                ch.basic_qos(prefetch_count=1)
                ch.basic_consume(queue="mining_gateway_q", on_message_callback=self.on_task)
                logger.info("Gateway ready, consuming mining tasks...")
                ch.start_consuming()
            except Exception as e:
                logger.error(f"Task consumer error, reconnecting: {e}")
                time.sleep(5)

    # ── Vuelta: recibe resultado del TrP y lo publica en nct_results ───────────

    def publish_nct_result(self, nct_result: dict):
        conn = self._connect_rabbitmq()
        try:
            ch = conn.channel()
            self._setup_exchanges(ch)
            ch.basic_publish(
                exchange="nct_results",
                routing_key="nct.result",
                body=json.dumps(nct_result),
                properties=pika.BasicProperties(delivery_mode=2),
            )
        finally:
            conn.close()


gateway = Gateway()


@asynccontextmanager
async def lifespan(app: FastAPI):
    t = threading.Thread(target=gateway.consume_tasks, daemon=True)
    t.start()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/ping")
def ping():
    return {"status": "ok", "service": "mining-gateway"}


@app.post("/result")
def result(nct_result: dict):
    # Autenticación: la hace el Ingress vía mTLS. Solo el TrP con un cert de
    # cliente firmado por nuestra CA llega hasta acá.
    task_id = nct_result.get("task_id")
    gateway.publish_nct_result(nct_result)
    logger.info(f"Result for task {task_id} published to nct_results")
    return {"status": "accepted"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
