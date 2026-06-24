import os
import json
import time
import uuid
import logging
import threading
from datetime import datetime, timezone
from collections import Counter

import pika
import redis

from blockchain import verify_block

logging.basicConfig(level=logging.INFO, format="%(asctime)s [NCT] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")
MINING_DIFFICULTY = int(os.environ.get("MINING_DIFFICULTY", "3"))
MAX_TX_PER_BLOCK = int(os.environ.get("MAX_TX_PER_BLOCK", "5"))
BLOCK_TIMEOUT = float(os.environ.get("BLOCK_TIMEOUT", "10"))


class NCT:
    def __init__(self):
        self.blocks_mined = 0
        self.tx_processed = 0
        self.pending_txs = []
        self.lock = threading.Lock()
        self._stop_event = threading.Event()

        # Connect Redis with retry
        self.redis = self._connect_redis()

        # RabbitMQ connection will be set up in start()
        self.connection = None
        self.channel_tx = None
        self.channel_results = None
        self.channel_publish = None

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
        channel.exchange_declare(exchange="transactions", exchange_type="direct", durable=True)
        channel.exchange_declare(exchange="mining", exchange_type="direct", durable=True)
        channel.exchange_declare(exchange="mining_results", exchange_type="direct", durable=True)
        channel.exchange_declare(exchange="nct_results", exchange_type="direct", durable=True)

    def _publish_task(self, task: dict):
        """Open a short-lived connection to publish a mining task (thread-safe)."""
        try:
            conn = self._connect_rabbitmq()
            ch = conn.channel()
            self._setup_exchanges(ch)
            ch.basic_publish(
                exchange="mining",
                routing_key="task.global",
                body=json.dumps(task),
                properties=pika.BasicProperties(delivery_mode=2),
            )
            conn.close()
        except Exception as e:
            logger.error(f"Failed to publish mining task: {e}")

    def start(self):
        logger.info("NCT starting...")
        conn_tx = self._connect_rabbitmq()
        conn_results = self._connect_rabbitmq()

        ch_tx = conn_tx.channel()
        ch_results = conn_results.channel()

        self._setup_exchanges(ch_tx)
        self._setup_exchanges(ch_results)

        # Queue for incoming transactions
        ch_tx.queue_declare(queue="transactions_q", durable=True)
        ch_tx.queue_bind(queue="transactions_q", exchange="transactions", routing_key="tx.new")

        # Queue for mining results directed to NCT
        ch_results.queue_declare(queue="nct_results_q", durable=True)
        ch_results.queue_bind(queue="nct_results_q", exchange="nct_results", routing_key="nct.result")

        ch_tx.basic_qos(prefetch_count=10)
        ch_tx.basic_consume(queue="transactions_q", on_message_callback=self._on_tx)

        ch_results.basic_qos(prefetch_count=1)
        ch_results.basic_consume(queue="nct_results_q", on_message_callback=self._on_mining_result)

        # Start timer thread for block formation
        timer_thread = threading.Thread(target=self._block_timer, daemon=True)
        timer_thread.start()

        # Start results consumer thread
        results_thread = threading.Thread(target=ch_results.start_consuming, daemon=True)
        results_thread.start()

        logger.info("NCT ready, consuming transactions...")
        try:
            ch_tx.start_consuming()
        except Exception as e:
            logger.error(f"TX consumer error: {e}")

    def _on_tx(self, ch, method, properties, body):
        try:
            tx = json.loads(body)
            logger.info(f"Received transaction: {tx.get('tx_id')} type={tx.get('type')}")
            with self.lock:
                self.pending_txs.append(tx)
                self.tx_processed += 1
                if len(self.pending_txs) >= MAX_TX_PER_BLOCK:
                    self._form_and_publish_block()
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing transaction: {e}")
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    def _block_timer(self):
        while not self._stop_event.is_set():
            time.sleep(BLOCK_TIMEOUT)
            with self.lock:
                if self.pending_txs:
                    logger.info(f"Block timeout reached with {len(self.pending_txs)} pending txs")
                    self._form_and_publish_block()

    def _get_dominant_event_id(self, txs: list) -> str:
        event_ids = [tx.get("event_id", "global") for tx in txs]
        if not event_ids:
            return "global"
        counter = Counter(event_ids)
        return counter.most_common(1)[0][0]

    def _get_last_block_hash(self, event_id: str) -> str:
        key = f"blockchain:{event_id}"
        last = self.redis.lindex(key, -1)
        if last:
            try:
                block = json.loads(last)
                return block.get("block_hash", "0" * 64)
            except Exception:
                pass
        return "0" * 64

    def _get_next_index(self, event_id: str) -> int:
        key = f"blockchain:{event_id}"
        return self.redis.llen(key)

    def _form_and_publish_block(self):
        """Must be called with self.lock held."""
        if not self.pending_txs:
            return

        txs = self.pending_txs[:]
        self.pending_txs = []

        event_id = self._get_dominant_event_id(txs)
        previous_hash = self._get_last_block_hash(event_id)
        index = self._get_next_index(event_id)

        block_candidate = {
            "index": index,
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "previous_hash": previous_hash,
            "nonce": 0,
            "transactions": txs,
            "block_type": "tx",
            "event_id": event_id,
        }

        task_id = str(uuid.uuid4())
        task = {
            "task_id": task_id,
            "event_id": event_id,
            "block_candidate": block_candidate,
            "difficulty": MINING_DIFFICULTY,
            "nonce_range_start": 0,
            "nonce_range_total": 10_000_000,
        }

        logger.info(f"Publishing mining task {task_id} for event {event_id} with {len(txs)} txs")
        pub_thread = threading.Thread(target=self._publish_task, args=(task,), daemon=True)
        pub_thread.start()

    def _on_mining_result(self, ch, method, properties, body):
        try:
            result = json.loads(body)
            logger.info(f"Received mining result for task {result.get('task_id')}")

            if not result.get("found"):
                logger.warning("Mining result: not found (range exhausted)")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            block = result.get("block")
            if not block:
                logger.error("Mining result missing block data")
                ch.basic_ack(delivery_tag=method.delivery_tag)
                return

            if not verify_block(block, MINING_DIFFICULTY):
                logger.error(f"Block verification failed for task {result.get('task_id')}")
                ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
                return

            event_id = block.get("event_id", "global")
            self._save_block(block, event_id)
            self._update_ticket_states(block)
            self.blocks_mined += 1
            logger.info(f"Block {block.get('index')} confirmed for event {event_id}. Total mined: {self.blocks_mined}")
            ch.basic_ack(delivery_tag=method.delivery_tag)
        except Exception as e:
            logger.error(f"Error processing mining result: {e}")
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)

    def _save_block(self, block: dict, event_id: str):
        key = f"blockchain:{event_id}"
        self.redis.rpush(key, json.dumps(block))
        logger.info(f"Block saved to Redis key {key}")

    def _update_ticket_states(self, block: dict):
        event_id = block.get("event_id", "global")
        for tx in block.get("transactions", []):
            tx_type = tx.get("type")
            ticket_id = tx.get("ticket_id")
            if not ticket_id:
                continue

            owner_key = f"ticket:{event_id}:{ticket_id}:owner"
            resales_key = f"ticket:{event_id}:{ticket_id}:resales"

            if tx_type == "emit":
                self.redis.set(owner_key, tx.get("to_wallet", "null"))
            elif tx_type == "buy":
                self.redis.set(owner_key, tx.get("to_wallet", "null"))
            elif tx_type == "resell":
                self.redis.set(owner_key, tx.get("to_wallet", "null"))
                self.redis.incr(resales_key)
