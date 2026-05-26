"""
hit6_plot.py — Compila hit6_benchmark, lo ejecuta y grafica los resultados.

Uso en Google Colab:
    !python hit6_plot.py
"""

import subprocess
import sys
import re
import matplotlib.pyplot as plt

DATA = "ticketchain:block:42:"

# ── 1. Compilar ────────────────────────────────────────────────────────────────
print("Compilando hit6_benchmark.cu...")
compile_result = subprocess.run(
    ["nvcc", "hit6_benchmark.cu", "-o", "hit6_benchmark"],
    capture_output=True, text=True
)
if compile_result.returncode != 0:
    print("ERROR al compilar:")
    print(compile_result.stderr)
    sys.exit(1)
print("Compilado OK.\n")

# ── 2. Ejecutar ────────────────────────────────────────────────────────────────
print(f"Ejecutando benchmark con data=\"{DATA}\" ...\n")
run_result = subprocess.run(
    ["./hit6_benchmark", DATA],
    capture_output=True, text=True,
    timeout=300
)
output = run_result.stdout
print(output)

# ── 3. Parsear tabla ───────────────────────────────────────────────────────────
# Formato de cada fila:
#   "0        " |               0 | d41d8cd98f00b204e9800998ecf8427e |      0.001 | 262.1
pattern = re.compile(
    r'"(0+)\s*"\s*\|\s*(\d+)\s*\|\s*([0-9a-f]{32})\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)'
)

rows = []
for line in output.splitlines():
    m = pattern.search(line)
    if m:
        rows.append({
            'prefix':  m.group(1),
            'n':       len(m.group(1)),
            'nonce':   int(m.group(2)),
            'hash':    m.group(3),
            'time':    float(m.group(4)),
            'mhs':     float(m.group(5)),
        })

if not rows:
    print("No se pudieron parsear resultados. Revisá la salida del benchmark.")
    sys.exit(1)

ns    = [r['n']    for r in rows]
times = [r['time'] for r in rows]
mhs   = [r['mhs']  for r in rows]

# ── 4. Graficar ────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(10, 6))
fig.suptitle(
    f'Hit #6 — Longitud de prefijo vs Tiempo de minado\nData: "{DATA}"',
    fontsize=13, fontweight='bold'
)

# Tiempo vs longitud (escala log)
ax.semilogy(ns, times, 'o-', color='royalblue', linewidth=2,
            markersize=9, zorder=3)

# Anotar cada punto
for r in rows:
    t_label = f"{r['time']:.3f}s" if r['time'] < 1 else f"{r['time']:.2f}s"
    ax.annotate(t_label, (r['n'], r['time']),
                textcoords="offset points", xytext=(8, 4), fontsize=9)

ax.set_xlabel('Longitud del prefijo (n ceros en hexadecimal)', fontsize=11)
ax.set_ylabel('Tiempo (segundos) — escala logarítmica', fontsize=11)
ax.set_title('Tiempo de minado vs longitud de prefijo')
ax.set_xticks(ns)
ax.set_xticklabels([f'"{"0"*n}"' for n in ns], fontsize=9)
ax.grid(True, which='both', alpha=0.3)

plt.tight_layout()
plt.savefig('hit6_benchmark.png', dpi=150, bbox_inches='tight')
plt.show()
print("Gráfico guardado: hit6_benchmark.png")

# ── 5. Resumen de respuestas ───────────────────────────────────────────────────
ultimo = rows[-1]
print("\n" + "="*60)
print("  RESPUESTAS AL HIT #6")
print("="*60)
print(f"  Prefijo más largo encontrado : {'0' * ultimo['n']} ({ultimo['n']} ceros hex)")
print(f"  Nonce encontrado             : {ultimo['nonce']}")
print(f"  Hash resultante              : {ultimo['hash']}")
print(f"  Tiempo                       : {ultimo['time']:.3f} segundos")
print(f"  Hash rate                    : {ultimo['mhs']:.1f} MH/s")
print()
print("  Relación tiempo vs longitud de prefijo:")
print("  Cada cero adicional (hex) multiplica el tiempo esperado x16,")
print("  ya que el espacio de búsqueda crece en un factor 16.")
print("  Factor observado en mediciones:")
for i in range(1, len(rows)):
    if rows[i-1]['time'] > 0:
        factor = rows[i]['time'] / rows[i-1]['time']
        print(f"    n={rows[i-1]['n']}→{rows[i]['n']}: x{factor:.1f}  "
              f"(teórico: x16)")
print("="*60)
