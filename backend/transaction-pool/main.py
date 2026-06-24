"""TrP entrypoint — API HTTP que recibe tareas del mining-gateway.

Autenticación cross-cluster: mTLS (la verifica el Ingress nginx). Las llamadas
que llegan a /mine ya vienen de un cliente con cert firmado por nuestra CA.

El POST /mine es síncrono (def) → FastAPI lo corre en su threadpool, así el
trabajo bloqueante de RabbitMQ no frena el event loop.
"""

import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI

from pool import TransactionPool

pool = TransactionPool()


@asynccontextmanager
async def lifespan(app: FastAPI):
    t = threading.Thread(target=pool.start_consumers, daemon=True)
    t.start()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/ping")
def ping():
    return {"status": "ok", "service": "transaction-pool"}


@app.post("/mine")
def mine(task: dict):
    task_id = pool.submit_task(task)
    return {"status": "accepted", "task_id": task_id}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
