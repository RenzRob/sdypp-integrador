import os
import json
import time
import logging
import threading

import pika

from miner import mine_range

logging.basicConfig(level=logging.INFO, format="%(asctime)s [WORKER] %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

RABBITMQ_URL = os.environ.get("RABBITMQ_URL", "amqp://guest:guest@localhost:5672")


def connect_rabbitmq():
    params = pika.URLParameters(RABBITMQ_URL)
    params.heartbeat = 600
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


def setup_exchanges(channel):
    channel.exchange_declare(exchange="mining_tasks", exchange_type="direct", durable=True)
    channel.exchange_declare(exchange="mining_results", exchange_type="direct", durable=True)


def process_fragment(ch, method, properties, body):
    try:
        fragment = json.loads(body)
        task_id = fragment.get("task_id")
        fragment_id = fragment.get("fragment_id")
        event_id = fragment.get("event_id", "global")
        block_candidate = fragment.get("block_candidate")
        difficulty = fragment.get("difficulty", 3)
        nonce_start = fragment.get("nonce_start", 0)
        nonce_end = fragment.get("nonce_end", 10_000_000)

        logger.info(
            f"Mining fragment {fragment_id} | task={task_id} | "
            f"nonces=[{nonce_start}, {nonce_end}) | difficulty={difficulty}"
        )

        # Create a separate connection for publishing keepalives and results
        pub_conn = connect_rabbitmq()
        pub_ch = pub_conn.channel()
        setup_exchanges(pub_ch)

        def keepalive_cb(current_nonce: int):
            try:
                kv = {
                    "task_id": task_id,
                    "fragment_id": fragment_id,
                    "nonce_current": current_nonce,
                    "timestamp": time.time(),
                }
                pub_ch.basic_publish(
                    exchange="mining_results",
                    routing_key="keepalive.global",
                    body=json.dumps(kv),
                    properties=pika.BasicProperties(delivery_mode=1),
                )
            except Exception as e:
                logger.warning(f"Keepalive publish failed: {e}")

        result = mine_range(block_candidate, difficulty, nonce_start, nonce_end, keepalive_cb=keepalive_cb)

        if result["found"]:
            logger.info(
                f"FOUND nonce={result['nonce']} hash={result['hash'][:16]}... "
                f"fragment={fragment_id} task={task_id}"
            )
        else:
            logger.info(f"Exhausted range [{nonce_start}, {nonce_end}) for fragment {fragment_id}")

        payload = {
            "task_id": task_id,
            "fragment_id": fragment_id,
            "event_id": event_id,
            "found": result["found"],
            "nonce": result["nonce"],
            "hash": result["hash"],
        }

        pub_ch.basic_publish(
            exchange="mining_results",
            routing_key="result.global",
            body=json.dumps(payload),
            properties=pika.BasicProperties(delivery_mode=2),
        )

        pub_conn.close()
        ch.basic_ack(delivery_tag=method.delivery_tag)
    except Exception as e:
        logger.error(f"Error processing fragment: {e}")
        try:
            ch.basic_nack(delivery_tag=method.delivery_tag, requeue=False)
        except Exception:
            pass


def main():
    while True:
        try:
            conn = connect_rabbitmq()
            ch = conn.channel()
            setup_exchanges(ch)

            ch.queue_declare(queue="mining_tasks_q", durable=True)
            ch.queue_bind(queue="mining_tasks_q", exchange="mining_tasks", routing_key="worker.task")

            ch.basic_qos(prefetch_count=1)
            ch.basic_consume(queue="mining_tasks_q", on_message_callback=process_fragment)

            logger.info("Worker ready, waiting for mining tasks...")
            ch.start_consuming()
        except Exception as e:
            logger.error(f"Worker error, reconnecting: {e}")
            time.sleep(5)


if __name__ == "__main__":
    main()
