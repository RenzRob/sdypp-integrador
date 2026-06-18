# Pilar 1 — Minero CPU y Minero GPU (CUDA)

Implementación de los mineros para TicketChain. El minero recibe datos de un bloque
y encuentra un **nonce** tal que `MD5(data + nonce)` empiece con un prefijo determinado
(**Proof of Work**).

---

## Estructura

```
pilar1-miner/
├── gpu/
│   ├── md5.cuh              ← Implementación MD5 reutilizable en device code
│   ├── hit2_hello_world.cu  ← Hit #2: info de GPU y primer kernel
│   ├── hit4_md5_hash.cu     ← Hit #4: MD5 de un string con GPU
│   ├── hit5_brute_force.cu  ← Hit #5: búsqueda sin límites
│   ├── hit6_benchmark.cu    ← Hit #6: benchmark tiempo vs longitud de prefijo
│   └── hit7_range_miner.cu  ← Hit #7: búsqueda en rango [start, end) ← usa el Pilar 2
└── cpu/
    └── miner.py             ← Minero CPU Python (fallback y comparativa)
```

---

## Cómo ejecutar en Google Colab

> No tenemos GPU NVIDIA nativa — usamos las T4 gratuitas de Colab.

### 1. Abrir Colab con GPU

1. Ir a [colab.research.google.com](https://colab.research.google.com)
2. **Entorno de ejecución → Cambiar tipo de entorno de ejecución → T4 GPU**
3. Verificar con:

```python
!nvidia-smi
!nvcc --version
```

### 2. Subir los archivos

```python
# Opción A: subir desde tu máquina
from google.colab import files
files.upload()   # seleccionar md5.cuh + el hit que quieras compilar

# Opción B: clonar el repo (cuando esté en GitHub)
# !git clone https://github.com/tu-usuario/ticketchain
# %cd ticketchain/pilar1-miner/gpu
```

### 3. Compilar y ejecutar cada Hit

#### Hit #2 — Hola Mundo
```bash
!nvcc hit2_hello_world.cu -o hit2 && ./hit2
```

#### Hit #4 — MD5 de un string
```bash
!nvcc hit4_md5_hash.cu -o hit4 && ./hit4 "hello world"
# Verificar: !echo -n "hello world" | md5sum
```

#### Hit #5 — Brute force
```bash
!nvcc hit5_brute_force.cu -o hit5 && ./hit5 "ticketchain:block:42:" "0000"
```

#### Hit #6 — Benchmark
```bash
!nvcc hit6_benchmark.cu -o hit6 && ./hit6 "ticketchain:block:42:"
```

#### Hit #7 — Rango acotado
```bash
# Buscar en [0, 5_000_000)
!nvcc hit7_range_miner.cu -o hit7 && ./hit7 "ticketchain:block:42:" "000" 0 5000000

# Si no hay solución en ese rango, retorna exit code 1
# Simular dos workers con rangos distintos:
!./hit7 "ticketchain:block:42:" "000" 0 1000000
!./hit7 "ticketchain:block:42:" "000" 1000000 2000000
```

#### Minero CPU (Python)
```bash
# Brute force
!python miner.py --data "ticketchain:block:42:" --prefix "000"

# Con rango
!python miner.py --data "ticketchain:block:42:" --prefix "000" --start 0 --end 500000

# Benchmark
!python miner.py --data "ticketchain:block:42:" --benchmark --max-prefix 5
```

---

## Comparativa GPU vs CPU (cierre del Pilar 1)

Ejecutar ambos mineros con los mismos parámetros y registrar los tiempos:

| Prefijo | GPU (T4) | CPU (Python) | Speedup |
|---------|----------|--------------|---------|
| `00`    | ~0.001s  | ~0.001s      | ~1x     |
| `000`   | ~0.001s  | ~0.05s       | ~50x    |
| `0000`  | ~0.005s  | ~0.8s        | ~160x   |
| `00000` | ~0.08s   | ~13s         | ~160x   |

> Los valores exactos dependen del hardware. Completar con las mediciones reales.

---

## Diseño de `md5.cuh`

La implementación sigue el estándar **RFC 1321**:
- Soporta mensajes de hasta **119 bytes** (2 bloques de 64 bytes)
- Padding automático con `0x80` + longitud en bits (little-endian)
- Funciones device: `md5_device()`, `md5_hex()`, `md5_check_prefix()`, `uint64_to_str()`

---

## Decisiones de diseño

- **MD5 en lugar de SHA-256**: el TP lo indica explícitamente para velocidad de iteración.
  SHA-256 es más seguro pero ~3-4x más lento en GPU.
- **Rango de búsqueda por lanzamiento** (`NONCES_PER_LAUNCH = 262.144`):
  balance entre latencia de kernel launch y granularidad de detección.
- **`atomicCAS` para el flag de solución**: garantiza que solo un thread
  "reclama" la solución aunque varios la encuentren simultáneamente.
- **Código de salida del Hit #7**: retorna `0` si encontró, `1` si no encontró
  en el rango — permite que el NCT del Pilar 2 interprete el resultado
  llamando al binario vía `subprocess`.
