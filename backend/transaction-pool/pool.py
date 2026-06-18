import os
import json
import time
import uuid
import logging
import threading

import pika
import redis

logging.basicConfig(level=logging.INFO, format="%(asctime)s [POOL] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
FRAGMENTS = int(os.environ.get("FRAGMENTS", "4"))
NONCE_RANGE = int(os.environ.get("NONCE_RANGE", "10000000"))
KEEPALIVE_TIMEOUT = int(os.environ.get("KEEPALIVE_TIMEOUT", "30"))


class TransactionPool:
    def __init__(self):
        self.redis = self._connect_redis()
        self.active_tasks = {}  # task_id -> task info
        self.lock = threading.Lock()

    def _connect_redis(self) -> redis.Redis:
        r = redis.from_url(REDIS_URL, decode_responses=True)
        for attempt in range(10):
            try:
                r.ping()
                logger.info("Redis connected")
                return r
            except redis.ConnectionError as e:
                logger.warning(f"Redis connection attempt {attempt + 1}/10 failed: {e}")
                time.sleep(3)
        raise RuntimeError("Could not connect to Redis after 10 attempts")

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
        channel.exchange_declare(exchange="mining", exchange_type="direct", durable=True)
        channel.exchange_declare(exchange="mining_tasks", exchange_type="direct", durable=True)
        channel.exchange_declare(exchange="mining_results", exchange_type="direct", durable=True)
        channel.exchange_declare(exchange="nct_results", exchange_type="direct", durable=True)

    def _publish_fragment(self, ch, task: dict, fragment_id: str, nonce_start: int, nonce_end: int):
        fragment = {
            "task_id": task["task_id"],
            "fragment_id": fragment_id,
            "event_id": task["event_id"],
            "block_candidate": task["block_candidate"],
            "difficulty": task["difficulty"],
            "nonce_start": nonce_start,
            "nonce_end": nonce_end,
        }
        # Store fragment info in Redis
        frag_key = f"mining:fragment:{fragment_id}"
        self.redis.setex(frag_key, 120, json.dumps({
            **fragment,
            "published_at": time.time(),
        }))
        ch.basic_publish(
            exchange="mining_tasks",
            routing_key="worker.task",
            body=json.dumps(fragment),
            properties=pika.BasicProperties(delivery_mode=2),
        )
        logger.info(f"Published fragment {fragment_id} nonces [{nonce_start}, {nonce_end})")

    def on_mining_task(self, ch, method, properties, body):
        try:
            task = json.loads(body)
            task_id = task.get("task_id")
            event_id = task.get("event_id", "global")
            logger.info(f"Received mining task {task_id} for event {event_id}")

            fragment_size = NONCE_RANGE // FRAGMENTS
            fragment_ids = []
            fragments_info = []

            for i in range(FRAGMENTS):
                fragment_id = str(uuid.uuid4())
                nonce_start = i * fragment_size
                nonce_end = nonce_start + fragment_size if i < FRAGMENTS - 1 else NONCE_RANGE

                self._publish_fragment(ch, task, fragment_id, nonce_start, nonce_end)
                fragment_ids.append(fragment_id)
                fragments_info.append({
                    "fragment_id": fragment_id,
                    "nonce_start": nonce_start,
                    "nonce_end": nonce_end,
                    "done": False,
                })

            # Store active task
            active_task_data = {
                "task_id": task_id,
                "event_id": event_id,
                "block_candidate": task["block_candidate"],
                "difficulty": task["difficulty"],
                "fragments": fragments_info,
                "completed": False,
                "published_at": time.time(),
            }
            task_key = f"mining:active_task:{task_id}"
            self.redis.setex(task_key, 300, json.dumps(active_task_data))

            with self.lock:
                self.active_tasks[task_id] = active_task_data

            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing mining task: {e}")
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

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

            # Check if task is still active
            task_key = f"mining:active_task:{task_id}"
            task_data_raw = self.redis.get(task_key)
            if not task_data_raw:
                logger.warning(f"Task {task_id} not found in Redis, may already be completed")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            task_data = json.loads(task_data_raw)
            if task_data.get("completed"):
                logger.info(f"Task {task_id} already completed, ignoring duplicate result")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            # Mark task as completed
            task_data["completed"] = True
            self.redis.setex(task_key, 300, json.dumps(task_data))

            with self.lock:
                if task_id in self.active_tasks:
                    self.active_tasks[task_id]["completed"] = True

            # Assemble confirmed block
            block = dict(task_data["block_candidate"])
            block["nonce"] = result["nonce"]
            block["block_hash"] = result["hash"]

            nct_result = {
                "task_id": task_id,
                "found": True,
                "nonce": result["nonce"],
                "hash": result["hash"],
                "block": block,
            }

            ch.basic_publish(
                exchange="nct_results",
                routing_key="nct.result",
                body=json.dumps(nct_result),
                properties=pika.BasicProperties(delivery_mode=2),
            )
            logger.info(f"Published confirmed block to NCT for task {task_id}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing worker result: {e}")
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    def on_keepalive(self, ch, method, properties, body):
        try:
            kv = json.loads(body)
            fragment_id = kv.get("fragment_id")
            if fragment_id:
                kv_key = f"mining:keepalive:{fragment_id}"
                self.redis.setex(kv_key, 60, str(time.time()))
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing keepalive: {e}")
            ch.basic_ack(delivery_tag=method.delivery_tag)

    def _keepalive_monitor(self):
        """Monitor keepalives and redistribute fragments if workers die."""
        while True:
            time.sleep(10)
            try:
                with self.lock:
                    tasks_snapshot = dict(self.active_tasks)

                for task_id, task_data in tasks_snapshot.items():
                    if task_data.get("completed"):
                        continue
                    for frag in task_data.get("fragments", []):
                        if frag.get("done"):
                            continue
                        fragment_id = frag["fragment_id"]
                        kv_key = f"mining:keepalive:{fragment_id}"
                        last_kv = self.redis.get(kv_key)
                        if last_kv:
                            elapsed = time.time() - float(last_kv)
                            if elapsed > KEEPALIVE_TIMEOUT:
                                logger.warning(f"Fragment {fragment_id} keepalive timeout, redistributing")
                                # Re-publish fragment
                                frag_key = f"mining:fragment:{fragment_id}"
                                frag_data_raw = self.redis.get(frag_key)
                                if frag_data_raw:
                                    frag_data = json.loads(frag_data_raw)
                                    # We need a channel to republish; use a new connection
                                    try:
                                        conn = self._connect_rabbitmq()
                                        ch = conn.channel()
                                        self._setup_exchanges(ch)
                                        ch.queue_declare(queue="mining_tasks_q", durable=True)
                                        ch.queue_bind(queue="mining_tasks_q", exchange="mining_tasks", routing_key="worker.task")
                                        ch.basic_publish(
                                            exchange="mining_tasks",
                                            routing_key="worker.task",
                                            body=json.dumps(frag_data),
                                            properties=pika.BasicProperties(delivery_mode=2),
                                        )
                                        conn.close()
                                        logger.info(f"Redistributed fragment {fragment_id}")
                                    except Exception as e:
                                        logger.error(f"Failed to redistribute fragment: {e}")
            except Exception as e:
                logger.error(f"Keepalive monitor error: {e}")

    def start(self):
        logger.info("TransactionPool starting...")
        conn_tasks = self._connect_rabbitmq()
        conn_results = self._connect_rabbitmq()
        conn_keepalive = self._connect_rabbitmq()

        ch_tasks = conn_tasks.channel()
        ch_results = conn_results.channel()
        ch_keepalive = conn_keepalive.channel()

        for ch in [ch_tasks, ch_results, ch_keepalive]:
            self._setup_exchanges(ch)

        # Queue for mining tasks from NCT
        ch_tasks.queue_declare(queue="mining_tasks_pool_q", durable=True)
        ch_tasks.queue_bind(queue="mining_tasks_pool_q", exchange="mining", routing_key="task.global")

        # Queue for worker results
        ch_results.queue_declare(queue="mining_results_pool_q", durable=True)
        ch_results.queue_bind(queue="mining_results_pool_q", exchange="mining_results", routing_key="result.global")

        # Queue for worker keepalives
        ch_keepalive.queue_declare(queue="mining_keepalive_q", durable=True)
        ch_keepalive.queue_bind(queue="mining_keepalive_q", exchange="mining_results", routing_key="keepalive.global")

        # Declare the worker tasks queue too so workers can consume
        ch_tasks.queue_declare(queue="mining_tasks_q", durable=True)
        ch_tasks.queue_bind(queue="mining_tasks_q", exchange="mining_tasks", routing_key="worker.task")

        ch_tasks.basic_qos(prefetch_count=1)
        ch_tasks.basic_consume(queue="mining_tasks_pool_q", on_message_callback=self.on_mining_task)

        ch_results.basic_qos(prefetch_count=10)
        ch_results.basic_consume(queue="mining_results_pool_q", on_message_callback=self.on_worker_result)

        ch_keepalive.basic_qos(prefetch_count=10)
        ch_keepalive.basic_consume(queue="mining_keepalive_q", on_message_callback=self.on_keepalive)

        # Start keepalive monitor
        monitor_thread = threading.Thread(target=self._keepalive_monitor, daemon=True)
        monitor_thread.start()

        # Start results and keepalive consumers in separate threads
        results_thread = threading.Thread(target=ch_results.start_consuming, daemon=True)
        results_thread.start()

        keepalive_thread = threading.Thread(target=ch_keepalive.start_consuming, daemon=True)
        keepalive_thread.start()

        logger.info("TransactionPool ready, consuming mining tasks...")
        try:
            ch_tasks.start_consuming()
        except Exception as e:
            logger.error(f"Tasks consumer error: {e}")
