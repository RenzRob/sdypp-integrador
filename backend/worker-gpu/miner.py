import json
import subprocess
import logging

logger = logging.getLogger(__name__)

MINER_BIN = "./range_miner"


def mine_range(
    block_candidate: dict,
    difficulty: int,
    nonce_start: int,
    nonce_end: int,
    keepalive_cb=None,
) -> dict:
    block_copy = {k: v for k, v in block_candidate.items() if k != "nonce"}
    data = json.dumps(block_copy, sort_keys=True)
    prefix = "0" * difficulty

    try:
        result = subprocess.run(
            [MINER_BIN, data, prefix, str(nonce_start), str(nonce_end)],
            capture_output=True,
            text=True,
            timeout=600,
        )

        for line in result.stdout.splitlines():
            if line.startswith("RESULT:NONCE="):
                parts = line.split(":")
                nonce = int(parts[1].split("=")[1])
                hash_val = parts[2].split("=")[1]
                return {"found": True, "nonce": nonce, "hash": hash_val}

        if result.returncode not in (0, 1):
            logger.error(f"GPU miner stderr: {result.stderr}")

        return {"found": False, "nonce": None, "hash": None}

    except subprocess.TimeoutExpired:
        logger.warning("GPU miner timed out")
        return {"found": False, "nonce": None, "hash": None}
    except FileNotFoundError:
        raise RuntimeError(f"CUDA binary not found: {MINER_BIN}")
