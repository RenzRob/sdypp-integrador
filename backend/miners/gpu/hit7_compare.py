"""
hit7_compare.py — Batería de tests de hit7 (GPU rango) + comparativa GPU vs CPU.

Uso en Google Colab:
    !python hit7_compare.py
"""

import subprocess
import sys
import re
import time
import hashlib
import matplotlib.pyplot as plt
import numpy as np

DATA   = "ticketchain:block:42:"
SEP    = "=" * 60

# ── 1. Compilar hit7 ──────────────────────────────────────────────────────────
print("Compilando hit7_range_miner.cu...")
r = subprocess.run(
    ["nvcc", "hit7_range_miner.cu", "-o", "hit7_range_miner"],
    capture_output=True, text=True
)
if r.returncode != 0:
    print("ERROR al compilar:\n", r.stderr)
    sys.exit(1)
print("OK\n")

# ── 2. Batería de tests hit7 ──────────────────────────────────────────────────
print(SEP)
print("  BATERÍA DE TESTS — Hit #7 (GPU con rango)")
print(SEP)

tests = [
    # (descripcion,              prefix,   start,      end,         espera_solución)
    ("Rango amplio, prefijo fácil",  "000",    0,          5_000_000,   True),
    ("Rango fuera de soluciones",    "000",    1,          50,          False),
    ("Prefijo medio, rango grande",  "0000",   0,          10_000_000,  True),
    ("Rango chico, prefijo largo",   "00000",  0,          10_000,      False),
    ("Rango acotado, prefijo medio", "0000",   5_000_000,  15_000_000,  True),
]

results_gpu = []

for desc, prefix, start, end, expect_found in tests:
    print(f"\n▶ {desc}")
    print(f"  Prefix={prefix!r}  Rango=[{start:,}, {end:,})")

    t0 = time.monotonic()
    proc = subprocess.run(
        ["./hit7_range_miner", DATA, prefix, str(start), str(end)],
        capture_output=True, text=True, timeout=120
    )
    elapsed_wall = time.monotonic() - t0
    out = proc.stdout

    # Parsear resultado
    found       = proc.returncode == 0
    nonce_match = re.search(r'Nonce:\s+(\d+)', out)
    hash_match  = re.search(r'Hash:\s+([0-9a-f]+)', out)
    mhs_match   = re.search(r'Hash rate:\s+([\d.]+)', out)
    time_match  = re.search(r'Tiempo:\s+([\d.]+)', out)

    nonce    = int(nonce_match.group(1))   if nonce_match  else None
    h        = hash_match.group(1)         if hash_match   else None
    mhs      = float(mhs_match.group(1))   if mhs_match    else 0.0
    gpu_time = float(time_match.group(1))  if time_match   else elapsed_wall

    if found:
        print(f"  ✓ Solución: nonce={nonce:,}  hash={h}")
        print(f"  Tiempo: {gpu_time:.3f}s  |  {mhs:.1f} MH/s")
    else:
        print(f"  ✗ Sin solución en el rango  ({gpu_time:.3f}s)")

    status = "✓ Encontrado" if found else "✗ No encontrado"
    ok     = (found == expect_found)
    print(f"  Resultado esperado: {'Encontrado' if expect_found else 'No encontrado'} → {'PASS ✅' if ok else 'FAIL ❌'}")

    results_gpu.append({
        'desc': desc, 'prefix': prefix, 'start': start, 'end': end,
        'found': found, 'nonce': nonce, 'hash': h,
        'time': gpu_time, 'mhs': mhs, 'ok': ok,
    })

# ── 3. Benchmark CPU (miner.py) ───────────────────────────────────────────────
print(f"\n{SEP}")
print("  BENCHMARK CPU — miner.py")
print(SEP)

MAX_PREFIX_CPU = 6

def cpu_mine(data, prefix):
    t0 = time.monotonic()
    nonce = 0
    while True:
        h = hashlib.md5(f"{data}{nonce}".encode()).hexdigest()
        if h.startswith(prefix):
            elapsed = time.monotonic() - t0
            return nonce, h, elapsed, nonce + 1
        nonce += 1

print(f"\n{'Prefijo':<10} | {'Nonce':>10} | {'Tiempo(s)':>10} | {'kH/s':>8}")
print("-" * 50)

results_cpu = []
for plen in range(1, MAX_PREFIX_CPU + 1):
    prefix = "0" * plen
    nonce, h, elapsed, total = cpu_mine(DATA, prefix)
    khs = total / elapsed / 1e3
    print(f'"{prefix}"{"":>{8-plen}} | {nonce:>10,} | {elapsed:>10.3f} | {khs:>8.1f}')
    sys.stdout.flush()
    results_cpu.append({'n': plen, 'time': elapsed, 'khs': khs})

# ── 4. Benchmark GPU (hit6_benchmark) ─────────────────────────────────────────
print(f"\n{SEP}")
print("  BENCHMARK GPU — hit6_benchmark")
print(SEP + "\n")

gpu_bench = subprocess.run(
    ["./hit6_benchmark", DATA],
    capture_output=True, text=True, timeout=300
)
bench_out = gpu_bench.stdout
print(bench_out)

pattern = re.compile(
    r'"(0+)\s*"\s*\|\s*(\d+)\s*\|\s*([0-9a-f]{32})\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)'
)
results_gpu_bench = []
for line in bench_out.splitlines():
    m = pattern.search(line)
    if m:
        results_gpu_bench.append({
            'n': len(m.group(1)),
            'time': float(m.group(4)),
            'mhs': float(m.group(5)),
        })

# ── 5. Comparativa GPU vs CPU ─────────────────────────────────────────────────
# Alinear por longitud de prefijo
common_ns = {r['n'] for r in results_cpu} & {g['n'] for g in results_gpu_bench}
common_ns = sorted(common_ns)
cpu_khs   = [r['khs'] for r in results_cpu       if r['n'] in common_ns]
gpu_mhs   = [g['mhs'] for g in results_gpu_bench if g['n'] in common_ns]

# Speedup
speedups  = [g * 1000 / c for g, c in zip(gpu_mhs, cpu_khs)]  # MH/s vs kH/s → factor

# ── 6. Graficar ───────────────────────────────────────────────────────────────
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(14, 6))
fig.suptitle('Cierre Etapa Inicial — Comparativa GPU vs CPU\nData: "ticketchain:block:42:"',
             fontsize=13, fontweight='bold')

x      = np.arange(len(common_ns))
width  = 0.35
labels = [f'"{"0"*n}"' for n in common_ns]

# Normalizar a MH/s para comparar
cpu_mhs_norm = [k / 1000 for k in cpu_khs]  # kH/s → MH/s

bars1 = ax1.bar(x - width/2, gpu_mhs,      width, label='GPU (CUDA T4)',  color='royalblue',   alpha=0.85)
bars2 = ax1.bar(x + width/2, cpu_mhs_norm, width, label='CPU (Python)',   color='tomato',      alpha=0.85)

ax1.set_yscale('log')
ax1.set_xlabel('Longitud de prefijo', fontsize=11)
ax1.set_ylabel('Throughput (MH/s) — escala logarítmica', fontsize=11)
ax1.set_title('Throughput GPU vs CPU')
ax1.set_xticks(x)
ax1.set_xticklabels(labels, fontsize=9)
ax1.legend(fontsize=10)
ax1.grid(True, axis='y', which='both', alpha=0.3)

for bar, v in zip(bars1, gpu_mhs):
    ax1.text(bar.get_x() + bar.get_width()/2, v * 1.4,
             f'{v:.2e}', ha='center', fontsize=8, color='royalblue', fontweight='bold')
for bar, v in zip(bars2, cpu_mhs_norm):
    ax1.text(bar.get_x() + bar.get_width()/2, v * 1.4,
             f'{v:.2e}', ha='center', fontsize=8, color='tomato', fontweight='bold')

# Gráfico 2: Speedup
ax2.bar(x, speedups, color='mediumseagreen', edgecolor='darkgreen', alpha=0.85, width=0.5)
ax2.set_xlabel('Longitud de prefijo', fontsize=11)
ax2.set_ylabel('Speedup GPU/CPU (veces más rápido)', fontsize=11)
ax2.set_title('Speedup GPU sobre CPU')
ax2.set_xticks(x)
ax2.set_xticklabels(labels, fontsize=9)
ax2.grid(True, axis='y', alpha=0.3)
for i, (xi, s) in enumerate(zip(x, speedups)):
    ax2.text(xi, s + max(speedups)*0.02, f'×{s:.0f}', ha='center', fontsize=10, fontweight='bold')

plt.tight_layout()
plt.savefig('hit7_compare.png', dpi=150, bbox_inches='tight')
plt.show()
print("Gráfico guardado: hit7_compare.png")

# ── 7. Resumen final ──────────────────────────────────────────────────────────
print(f"\n{SEP}")
print("  RESUMEN COMPARATIVO GPU vs CPU")
print(SEP)
print(f"\n{'Prefijo':<10} | {'CPU (kH/s)':>12} | {'GPU (MH/s)':>12} | {'Speedup':>10}")
print("-" * 55)
for n, c, g, s in zip(common_ns, cpu_khs, gpu_mhs, speedups):
    print(f'{"0"*n:<10} | {c:>12.1f} | {g:>12.1f} | {s:>9.0f}x')
print(f"\nSpeedup promedio: ×{sum(speedups)/len(speedups):.0f}")
print(f"Speedup máximo:   ×{max(speedups):.0f}")
print(SEP)
