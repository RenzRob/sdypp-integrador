"""
miner.py — Minero CPU en Python

Equivalente al miner GPU pero ejecutado en CPU con hashlib.
Sirve para:
  1. Comparativa GPU vs CPU (cierre del Pilar 1)
  2. Fallback cuando no hay GPU disponible (Pilar 2, P5)
  3. Worker CPU que el TrP levanta dinámicamente en Kubernetes

Uso:
  # Sin rango (brute force completo)
  python miner.py --data "ticketchain:block:42:" --prefix "0000"

  # Con rango (modo worker distribuido)
  python miner.py --data "ticketchain:block:42:" --prefix "000" --start 0 --end 1000000

  # Benchmark de prefijos 1..N
  python miner.py --data "ticketchain:block:42:" --benchmark --max-prefix 6
"""

import hashlib
import argparse
import time
import sys


# ─── Core: calcular MD5 de data+nonce ────────────────────────────────────────

def compute_md5(data: str, nonce: int) -> str:
    """Calcula MD5(data + str(nonce)) y devuelve el hash en hex."""
    message = f"{data}{nonce}".encode()
    return hashlib.md5(message).hexdigest()


# ─── Minería sin rango ────────────────────────────────────────────────────────

def mine(data: str, prefix: str) -> tuple[int, str, float, int]:
    """
    Busca nonce tal que MD5(data+nonce) empiece con prefix.
    Devuelve (nonce, hash, tiempo_segundos, total_hashes).
    """
    t_start = time.monotonic()
    nonce = 0
    while True:
        h = compute_md5(data, nonce)
        if h.startswith(prefix):
            elapsed = time.monotonic() - t_start
            return nonce, h, elapsed, nonce + 1
        nonce += 1


# ─── Minería con rango ────────────────────────────────────────────────────────

def mine_range(data: str, prefix: str, start: int, end: int) -> tuple[int | None, str | None, float, int]:
    """
    Busca nonce en [start, end) tal que MD5(data+nonce) empiece con prefix.
    Devuelve (nonce, hash, tiempo, total_hashes).
    Si no encuentra, nonce=None y hash=None.
    """
    t_start = time.monotonic()
    for nonce in range(start, end):
        h = compute_md5(data, nonce)
        if h.startswith(prefix):
            elapsed = time.monotonic() - t_start
            return nonce, h, elapsed, nonce - start + 1

    elapsed = time.monotonic() - t_start
    return None, None, elapsed, end - start


# ─── Benchmark ───────────────────────────────────────────────────────────────

def benchmark(data: str, max_prefix: int):
    """Mide tiempo para prefijos de longitud 1 a max_prefix."""
    print(f"\n{'Prefijo':<12} | {'Nonce':>12} | {'Hash':<34} | {'Tiempo(s)':>10} | {'kH/s':>8}")
    print("-" * 90)

    for plen in range(1, max_prefix + 1):
        prefix = "0" * plen
        nonce, h, elapsed, total = mine(data, prefix)
        khs = total / elapsed / 1e3 if elapsed > 0 else 0
        print(f'"{prefix}"{"":>{10-plen}} | {nonce:>12} | {h} | {elapsed:>10.3f} | {khs:>8.1f}')
        sys.stdout.flush()

    print()
    print("Nota: cada caracter adicional en el prefijo multiplica el tiempo ~16x")


# ─── CLI ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Minero CPU para TicketChain")
    parser.add_argument("--data",       required=True,  help="String base del bloque")
    parser.add_argument("--prefix",     default="0000", help="Prefijo requerido en el hash")
    parser.add_argument("--start",      type=int, default=None, help="Nonce inicial del rango")
    parser.add_argument("--end",        type=int, default=None, help="Nonce final del rango (exclusivo)")
    parser.add_argument("--benchmark",  action="store_true",    help="Modo benchmark")
    parser.add_argument("--max-prefix", type=int, default=6,    help="Longitud máxima de prefijo en benchmark")
    args = parser.parse_args()

    print("=" * 50)
    print("  Minero CPU — TicketChain Pilar 1")
    print("=" * 50)

    # ── Modo benchmark ────────────────────────────────────────────────────────
    if args.benchmark:
        print(f'\nData: "{args.data}"')
        benchmark(args.data, args.max_prefix)
        return

    # ── Modo rango ────────────────────────────────────────────────────────────
    if args.start is not None and args.end is not None:
        print(f'\nData:    "{args.data}"')
        print(f'Prefijo: "{args.prefix}"')
        print(f'Rango:   [{args.start}, {args.end})')
        print(f'Nonces:  {args.end - args.start:,}\n')

        nonce, h, elapsed, total = mine_range(
            args.data, args.prefix, args.start, args.end
        )

        if nonce is None:
            print(f"✗ No se encontró solución en el rango")
            print(f"  Hashes probados: {total:,}")
            print(f"  Tiempo:          {elapsed:.3f} s")
            print(f"  Hash rate:       {total/elapsed/1e3:.1f} kH/s")
            sys.exit(1)
        else:
            print(f"✓ ¡Solución encontrada!")
            print(f"  Nonce:        {nonce:,}")
            print(f"  Hash:         {h}")
            print(f"  Hashes prob.: {total:,}")
            print(f"  Tiempo:       {elapsed:.3f} s")
            print(f"  Hash rate:    {total/elapsed/1e3:.1f} kH/s")
            # Línea parseable por el NCT
            print(f"\nRESULT:NONCE={nonce}:HASH={h}")
        return

    # ── Modo brute force sin límite ───────────────────────────────────────────
    print(f'\nData:    "{args.data}"')
    print(f'Prefijo: "{args.prefix}"\n')
    print("Minando", end="", flush=True)

    nonce, h, elapsed, total = mine(args.data, args.prefix)

    print(f"\n\n✓ ¡Solución encontrada!")
    print(f"  Nonce:        {nonce:,}")
    print(f"  Hash:         {h}")
    print(f"  Hashes prob.: {total:,}")
    print(f"  Tiempo:       {elapsed:.3f} s")
    print(f"  Hash rate:    {total/elapsed/1e3:.1f} kH/s")
    print(f"\nRESULT:NONCE={nonce}:HASH={h}")


if __name__ == "__main__":
    main()
