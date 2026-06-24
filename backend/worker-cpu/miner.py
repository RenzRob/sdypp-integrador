import hashlib
import json
import time


def _block_data(block_candidate: dict) -> str:
    """Serialización canónica del bloque SIN nonce — idéntica a la del worker GPU
    (CUDA) y a la que valida el NCT. Sobre esto se calcula MD5(data + nonce)."""
    block_copy = {k: v for k, v in block_candidate.items() if k != "nonce"}
    return json.dumps(block_copy, sort_keys=True)


def mine_range(
    block_candidate: dict,
    difficulty: int,
    nonce_start: int,
    nonce_end: int,
    keepalive_cb=None,
) -> dict:
    prefix = "0" * difficulty
    data = _block_data(block_candidate)
    last_keepalive = time.time()

    for nonce in range(nonce_start, nonce_end):
        # MD5(data + nonce): mismo esquema que el minero GPU (Pilar 1) y el NCT.
        h = hashlib.md5((data + str(nonce)).encode()).hexdigest()

        if time.time() - last_keepalive > 5:
            if keepalive_cb:
                keepalive_cb(nonce)
            last_keepalive = time.time()

        if h.startswith(prefix):
            return {"found": True, "nonce": nonce, "hash": h}

    return {"found": False, "nonce": None, "hash": None}
