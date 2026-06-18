import asyncio
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from nct import NCT

nct_instance = NCT()


@asynccontextmanager
async def lifespan(app: FastAPI):
    loop = asyncio.get_event_loop()
    t = threading.Thread(target=nct_instance.start, daemon=True)
    t.start()
    yield


app = FastAPI(lifespan=lifespan)


@app.get("/ping")
def ping():
    return {"status": "ok", "service": "nct", "blocks_mined": nct_instance.blocks_mined}


@app.get("/stats")
def stats():
    return {
        "blocks_mined": nct_instance.blocks_mined,
        "tx_processed": nct_instance.tx_processed,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
