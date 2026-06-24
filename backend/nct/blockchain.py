import hashlib
import json


def _block_data(block: dict) -> str:
    """Serialización canónica del bloque SIN nonce ni block_hash.
    Idéntica a la que usan los mineros CPU y GPU (CUDA)."""
    block_copy = {k: v for k, v in block.items() if k not in ("nonce", "block_hash")}
    return json.dumps(block_copy, sort_keys=True)


def compute_hash(block: dict, nonce: int) -> str:
    """MD5(data + nonce) — mismo esquema de PoW que los mineros CPU y GPU."""
    return hashlib.md5((_block_data(block) + str(nonce)).encode()).hexdigest()


def verify_block(block: dict, difficulty: int) -> bool:
    prefix = "0" * difficulty
    block_hash = block.get("block_hash", "")
    if not block_hash.startswith(prefix):
        return False
    recomputed = compute_hash(block, block.get("nonce"))
    return recomputed == block_hash
