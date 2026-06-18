import hashlib
import json
import time


def compute_hash(block_data: dict) -> str:
    block_copy = dict(block_data)
    block_string = json.dumps(block_copy, sort_keys=True)
    return hashlib.sha256(block_string.encode()).hexdigest()


def mine_range(
    block_candidate: dict,
    difficulty: int,
    nonce_start: int,
    nonce_end: int,
    keepalive_cb=None,
) -> dict:
    prefix = "0" * difficulty
    last_keepalive = time.time()
    block = dict(block_candidate)

    for nonce in range(nonce_start, nonce_end):
        block["nonce"] = nonce
        h = compute_hash(block)

        if time.time() - last_keepalive > 5:
            if keepalive_cb:
                keepalive_cb(nonce)
            last_keepalive = time.time()

        if h.startswith(prefix):
            return {"found": True, "nonce": nonce, "hash": h}

    return {"found": False, "nonce": None, "hash": None}
