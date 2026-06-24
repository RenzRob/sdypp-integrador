"""TrP entrypoint — proceso PULL (sin servidor HTTP).

g-404 no expone ningún endpoint. El TrP:
  - consume los resultados de los workers del RabbitMQ local (thread en background)
  - hace polling al mining-gateway por HTTPS+mTLS para traer tareas (thread principal)
"""

import threading

from pool import TransactionPool

pool = TransactionPool()


if __name__ == "__main__":
    # Consumidores de resultados/keepalive de los workers (RabbitMQ local).
    threading.Thread(target=pool.start_consumers, daemon=True).start()
    # Loop de polling al gateway (solo llamadas salientes).
    pool.poll_loop()
