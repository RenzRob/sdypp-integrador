"""TransactionPool (TrP) — vive en el cluster del profe, junto a los workers.

Ya NO consume tareas de un RabbitMQ compartido entre clusters. Ahora:

  - Recibe la tarea de minado por HTTP (POST /mine, lo dispara main.py) desde el
    mining-gateway del otro cluster.
  - Fragmenta el espacio de nonces y publica los fragmentos en el RabbitMQ LOCAL
    (exchange "mining_tasks" → cola que consumen los workers).
  - Consume los resultados de los workers del RabbitMQ LOCAL (exchange
    "mining_results").
  - Cuando un fragmento encuentra el nonce, arma el bloque y lo devuelve al
    mining-gateway por HTTP (POST /result), que lo publica en nct_results → NCT.

Estado en memoria (no hay Redis en el cluster del profe).
"""

import os
import json
import time
import uuid
import logging
import threading

import pika
import requests

logging.basicConfig(level=logging.INFO, format="%(asctime)s [POOL] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
GATEWAY_URL = os.environ.get("GATEWAY_URL", "http://localhost:8000").rstrip("/")
FRAGMENTS = int(os.environ.get("FRAGMENTS", "4"))
NONCE_RANGE = int(os.environ.get("NONCE_RANGE", "10000000"))
KEEPALIVE_TIMEOUT = int(os.environ.get("KEEPALIVE_TIMEOUT", "30"))
HTTP_TIMEOUT = float(os.environ.get("HTTP_TIMEOUT", "10"))

# mTLS: cert+key de cliente propio y CA para verificar al mining-gateway.
CLIENT_CERT = os.environ.get("CLIENT_CERT_PATH", "/certs/tls.crt")
CLIENT_KEY = os.environ.get("CLIENT_KEY_PATH", "/certs/tls.key")
CA_CERT = os.environ.get("CA_CERT_PATH", "/ca/ca.crt")


class TransactionPool:
    def __init__(self):
        # Estado en memoria, protegido por lock.
        self.active_tasks = {}   # task_id -> task data + fragments
        self.fragments = {}      # fragment_id -> fragment dict (para redistribuir)
        self.keepalives = {}     # fragment_id -> last keepalive timestamp
        self.lock = threading.Lock()

    # ── RabbitMQ local ─────────────────────────────────────────────────────────

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

    def _setup_exchanges(self, channel):
        channel.exchange_declare(exchange="mining_tasks", exchange_type="direct", durable=True)
        channel.exchange_declare(exchange="mining_results", exchange_type="direct", durable=True)

    # ── Ida: fragmentación y publicación a los workers ─────────────────────────

    def _publish_fragment(self, ch, task: dict, fragment_id: str, nonce_start: int, nonce_end: int):
        fragment = {
            "task_id": task["task_id"],
            "fragment_id": fragment_id,
            "event_id": task.get("event_id", "global"),
            "block_candidate": task["block_candidate"],
            "difficulty": task["difficulty"],
            "nonce_start": nonce_start,
            "nonce_end": nonce_end,
        }
        with self.lock:
            self.fragments[fragment_id] = {**fragment, "published_at": time.time()}
        ch.basic_publish(
            exchange="mining_tasks",
            routing_key="worker.task",
            body=json.dumps(fragment),
            properties=pika.BasicProperties(delivery_mode=2),
        )
        logger.info(f"Published fragment {fragment_id} nonces [{nonce_start}, {nonce_end})")

    def submit_task(self, task: dict):
        """Recibe la tarea desde HTTP /mine, la fragmenta y la encola para workers.

        Usa una conexión efímera para publicar (thread-safe: lo llama el threadpool
        de FastAPI, separado de los threads consumidores).
        """
        task_id = task.get("task_id") or str(uuid.uuid4())
        event_id = task.get("event_id", "global")
        logger.info(f"Received mining task {task_id} for event {event_id}")

        conn = self._connect_rabbitmq()
        try:
            ch = conn.channel()
            self._setup_exchanges(ch)
            ch.queue_declare(queue="mining_tasks_q", durable=True)
            ch.queue_bind(queue="mining_tasks_q", exchange="mining_tasks", routing_key="worker.task")

            fragment_size = NONCE_RANGE // FRAGMENTS
            fragments_info = []
            for i in range(FRAGMENTS):
                fragment_id = str(uuid.uuid4())
                nonce_start = i * fragment_size
                nonce_end = nonce_start + fragment_size if i < FRAGMENTS - 1 else NONCE_RANGE
                self._publish_fragment(ch, task, fragment_id, nonce_start, nonce_end)
                fragments_info.append({
                    "fragment_id": fragment_id,
                    "nonce_start": nonce_start,
                    "nonce_end": nonce_end,
                    "done": False,
                })
        finally:
            conn.close()

        with self.lock:
            self.active_tasks[task_id] = {
                "task_id": task_id,
                "event_id": event_id,
                "block_candidate": task["block_candidate"],
                "difficulty": task["difficulty"],
                "fragments": fragments_info,
                "completed": False,
                "published_at": time.time(),
            }
        return task_id

    # ── Vuelta: resultado del worker → gateway por HTTP ────────────────────────

    def _post_to_gateway(self, nct_result: dict) -> bool:
        for attempt in range(5):
            try:
                resp = requests.post(
                    f"{GATEWAY_URL}/result",
                    json=nct_result,
                    cert=(CLIENT_CERT, CLIENT_KEY),
                    verify=CA_CERT,
                    timeout=HTTP_TIMEOUT,
                )
                if resp.status_code in (200, 202):
                    return True
                logger.warning(f"Gateway rejected result: {resp.status_code} {resp.text}")
            except Exception as e:
                logger.warning(f"Result delivery attempt {attempt + 1}/5 failed: {e}")
            time.sleep(2)
        logger.error("Could not deliver result to gateway after 5 attempts")
        return False

    def on_worker_result(self, ch, method, properties, body):
        try:
            result = json.loads(body)
            task_id = result.get("task_id")
            fragment_id = result.get("fragment_id")
            found = result.get("found", False)
            logger.info(f"Worker result: task={task_id} fragment={fragment_id} found={found}")

            if not found:
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            with self.lock:
                task_data = self.active_tasks.get(task_id)
                if not task_data:
                    logger.warning(f"Task {task_id} not active, ignoring result")
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                    return
                if task_data.get("completed"):
                    logger.info(f"Task {task_id} already completed, ignoring duplicate")
                    ch.basic_ack(delivery_tag=method.delivery_tag)
                    return
                task_data["completed"] = True
                block_candidate = task_data["block_candidate"]

            block = dict(block_candidate)
            block["nonce"] = result["nonce"]
            block["block_hash"] = result["hash"]

            nct_result = {
                "task_id": task_id,
                "found": True,
                "nonce": result["nonce"],
                "hash": result["hash"],
                "block": block,
            }
            self._post_to_gateway(nct_result)
            logger.info(f"Confirmed block for task {task_id} sent to gateway")
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing worker result: {e}")
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    # ── Keepalive de workers ───────────────────────────────────────────────────

    def on_keepalive(self, ch, method, properties, body):
        try:
            kv = json.loads(body)
            fragment_id = kv.get("fragment_id")
            if fragment_id:
                with self.lock:
                    self.keepalives[fragment_id] = time.time()
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing keepalive: {e}")
            ch.basic_ack(delivery_tag=method.delivery_tag)

    def _keepalive_monitor(self):
        """Redistribuye fragmentos cuyos workers dejaron de mandar keepalive."""
        while True:
            time.sleep(10)
            try:
                with self.lock:
                    tasks_snapshot = {
                        tid: td for tid, td in self.active_tasks.items()
                        if not td.get("completed")
                    }
                for task_id, task_data in tasks_snapshot.items():
                    for frag in task_data.get("fragments", []):
                        if frag.get("done"):
                            continue
                        fragment_id = frag["fragment_id"]
                        with self.lock:
                            last_kv = self.keepalives.get(fragment_id)
                            frag_data = self.fragments.get(fragment_id)
                        if last_kv and (time.time() - last_kv) > KEEPALIVE_TIMEOUT and frag_data:
                            logger.warning(f"Fragment {fragment_id} keepalive timeout, redistributing")
                            try:
                                conn = self._connect_rabbitmq()
                                ch = conn.channel()
                                self._setup_exchanges(ch)
                                ch.basic_publish(
                                    exchange="mining_tasks",
                                    routing_key="worker.task",
                                    body=json.dumps({k: v for k, v in frag_data.items() if k != "published_at"}),
                                    properties=pika.BasicProperties(delivery_mode=2),
                                )
                                conn.close()
                                logger.info(f"Redistributed fragment {fragment_id}")
                            except Exception as e:
                                logger.error(f"Failed to redistribute fragment: {e}")
            except Exception as e:
                logger.error(f"Keepalive monitor error: {e}")

    # ── Consumidores en background (los arranca main.py) ───────────────────────

    def start_consumers(self):
        logger.info("TransactionPool consumers starting...")
        conn_results = self._connect_rabbitmq()
        conn_keepalive = self._connect_rabbitmq()

        ch_results = conn_results.channel()
        ch_keepalive = conn_keepalive.channel()
        for ch in [ch_results, ch_keepalive]:
            self._setup_exchanges(ch)

        ch_results.queue_declare(queue="mining_results_pool_q", durable=True)
        ch_results.queue_bind(queue="mining_results_pool_q", exchange="mining_results", routing_key="result.global")

        ch_keepalive.queue_declare(queue="mining_keepalive_q", durable=True)
        ch_keepalive.queue_bind(queue="mining_keepalive_q", exchange="mining_results", routing_key="keepalive.global")

        ch_results.basic_qos(prefetch_count=10)
        ch_results.basic_consume(queue="mining_results_pool_q", on_message_callback=self.on_worker_result)

        ch_keepalive.basic_qos(prefetch_count=10)
        ch_keepalive.basic_consume(queue="mining_keepalive_q", on_message_callback=self.on_keepalive)

        monitor_thread = threading.Thread(target=self._keepalive_monitor, daemon=True)
        monitor_thread.start()

        keepalive_thread = threading.Thread(target=ch_keepalive.start_consuming, daemon=True)
        keepalive_thread.start()

        logger.info("TransactionPool ready, consuming worker results...")
        try:
            ch_results.start_consuming()
        except Exception as e:
            logger.error(f"Results consumer error: {e}")
