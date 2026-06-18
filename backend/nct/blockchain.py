import hashlib
import json


def compute_hash(block_data: dict) -> str:
    block_string = json.dumps(block_data, sort_keys=True)
    return hashlib.sha256(block_string.encode()).hexdigest()


def verify_block(block: dict, difficulty: int) -> bool:
    prefix = "0" * difficulty
    block_hash = block.get("block_hash", "")
    if not block_hash.startswith(prefix):
        return False
    # Recompute hash without the block_hash field
    block_copy = {k: v for k, v in block.items() if k != "block_hash"}
    recomputed = compute_hash(block_copy)
    return recomputed == block_hash
