# Hit #2 - Hola mundo en cuda

Entorno de ejecucion: Google colab
- Python 3
- GPU T4
- RAM 12GB
- Disco 112GB

![CUDA](../imagenes/entorno2.png)
![NVIDIA](../imagenes/entorno3.png)
![Entorno de ejecución](../imagenes/entorno.png)

# Hit #3 - Librerias CUDA

## ¿Qué es CCCL?

**CUDA Core Compute Libraries (CCCL)** es el repositorio unificado de NVIDIA que consolida tres bibliotecas esenciales de C++ para programación en GPU:

| Biblioteca | Rol |
|---|---|
| **Thrust** | Algoritmos paralelos de alto nivel (tipo STL) |
| **CUB** | Primitivas de bajo nivel optimizadas por hardware |
| **libcudacxx** | Implementación de la std de C++ para host y device |

El repositorio original `github.com/nvidia/thrust` fue **archivado en marzo de 2024**. Thrust vive ahora dentro de [github.com/NVIDIA/cccl](https://github.com/NVIDIA/cccl).

**Última actualización:** versión **v3.3.3** publicada el **20 de abril de 2026**.

## ¿Qué es Thrust?

Thrust es una biblioteca de algoritmos paralelos con una API inspirada en la STL de C++. Permite escribir código CUDA de alto rendimiento sin manejar directamente kernels, sincronización ni gestión de memoria en GPU.

## CUDA a pelo vs Thrust/CCCL

| Aspecto | CUDA "a pelo" | Thrust / CCCL |
|---|---|---|
| **Gestión de memoria** | Manual: `cudaMalloc`, `cudaFree`, `cudaMemcpy` | Automática: `host_vector`, `device_vector` |
| **Kernels** | Hay que escribirlos explícitamente con `__global__` | Se usan funciones como `thrust::sort`, `thrust::reduce` |
| **Sincronización** | Manual: `cudaDeviceSynchronize()` | Manejada internamente |
| **Algoritmos** | Hay que implementarlos desde cero | Vienen incluidos (sort, scan, transform, reduce, etc.) |
| **Portabilidad** | Solo GPU NVIDIA | El mismo código puede correr en CPU (back-end TBB/OpenMP) |
| **Curva de aprendizaje** | Alta: hay que conocer grids, blocks, warps | Baja: similar a `std::vector` y `<algorithm>` |
| **Depuración** | Difícil, errores silenciosos | Más sencilla, errores más descriptivos |

## Ejemplo de la sección Vectors

```cpp
#include <thrust/host_vector.h>
#include <thrust/device_vector.h>
#include <iostream>

int main(void)
{
    // host_vector vive en RAM
    thrust::host_vector<int> H(4);
    H[0] = 14;
    H[1] = 20;
    H[2] =  3;
    H[3] = 27;

    // Copiar al device (GPU) — la transferencia es automática
    thrust::device_vector<int> D = H;

    // Modificar un elemento en device
    D[0] = 99;

    // Imprimir
    for (int i = 0; i < D.size(); i++)
        std::cout << "D[" << i << "] = " << D[i] << std::endl;

    return 0;
}
```

Thrust viene incluido con el CUDA Toolkit, por lo que **no hace falta instalar nada adicional**.

**Ejemplo ejecutado en Google colab:**
![Salida Programa thrust vectors](../imagenes/salida_thrust_vectors.png)

# Hit #4 - Introducción a HASH usando CUDA

Se implementaron los codigos [hit4_md5_hash.cu](../pilar1-miner/gpu/hit4_md5_hash.cu) y [md5.cuh](../pilar1-miner/gpu/md5.cuh) para calcular un hash utilizando CUDA.

**Resultado:**
![hit4_md5.png](../imagenes/hit4_md5.png)

Se comparo el resultado del hash contra el de la herramienta `md5sum` nativo de linux.

# Hit #5 - HASH por fuerza bruta con CUDA

Para este hit se utilizan los archivos [hit5_brute_force.cu](../pilar1-miner/gpu/hit5_brute_force.cu) y [md5.cuh](../pilar1-miner/gpu/md5.cuh).

1. Se suben los files a colab
2. Se compila el codigo ![hit5_compilacion.png](../imagenes/hit5_compilacion.png)
3. Busqueda de prefijo "00" ![hit5_busqueda_00.png](../imagenes/hit5_busqueda_00.png)
4. Busqueda de prefijo "0000" ![hit5_busqueda_00.png](../imagenes/hit5_busqueda_0000.png)
5. Busqueda de prefijo "00000" y comparo resultado contra md5sum ![hit5_busqueda_00.png](../imagenes/hit5_busqueda_00000.png)

# Hit #6 - Longitudes de prefijo en CUDA HASH

Se utilizan los archivos [hit6_plot.py](../pilar1-miner/gpu/hit6_plot.py) y [hit6_benchmark.cu](../pilar1-miner/gpu/hit6_benchmark.cu).

Tiempo vs longitud de prefijo:

Ejecucion:
![hit6.png](../imagenes/hit6.png)

Gráfico:
![hit6_benchmark.png](../imagenes/hit6_benchmark.png)

## Mediciones

| Prefijo | Tiempo |
|---|---|
| `"0"` | 0.001s |
| `"00"` | 0.001s |
| `"000"` | 0.001s |
| `"0000"` | 0.001s |
| `"00000"` | 0.001s |
| `"000000"` | 0.010s |
| `"0000000"` | 0.390s |
| `"00000000"` | 0.389s |
| `"000000000"` | 5.22s |

## Respuestas

**¿Cuál es el prefijo más largo que logró encontrar?**
El prefijo más largo encontrado fue `"000000000"` (9 ceros hexadecimales), ejecutado sobre una GPU T4 en Google Colab.

**¿Cuánto tardó?**
5.22 segundos.

**¿Cuál es la relación entre la longitud del prefijo y el tiempo requerido?**
La relación es **exponencial**: cada cero adicional en el prefijo multiplica el espacio de búsqueda por 16 (ya que cada carácter hexadecimal tiene 16 posibles valores). En el gráfico, con escala logarítmica en el eje Y, la curva sigue una línea recta ascendente, lo que confirma el crecimiento exponencial.

En la práctica se observa que los prefijos cortos (1 a 5 ceros) se resuelven en menos de 1ms cada uno, ya que la solución aparece en los primeros lanzamientos del kernel. A partir de 6 ceros el tiempo empieza a crecer notablemente: de 0.010s a 5.22s entre 6 y 9 ceros, lo que representa un factor de ~500x para 3 ceros adicionales (cercano al teórico de 16³ = 4096x, con variación estadística por el componente aleatorio de la búsqueda).

# Hit #7 - HASH por fuerza bruta con CUDA (con límites)

Se utilizan los archivos [hit7_range_miner.cu](../pilar1-miner/gpu/hit7_range_miner.cu) y [hit7_compare.py](../pilar1-miner/gpu/hit7_compare.py).

El programa recibe cuatro parámetros: `data`, `prefijo`, `range_start` y `range_end`. Busca un nonce dentro del rango `[start, end)` tal que `MD5(data + nonce)` empiece con el prefijo. Si no encuentra ninguno en ese rango, lo informa y termina con código de salida 1.

## Batería de tests

| # | Descripción | Prefijo | Rango | Resultado |
|---|---|---|---|---|
| 1 | Rango amplio, prefijo fácil | `"000"` | [0, 5.000.000) | ✓ nonce=31.707 — PASS ✅ |
| 2 | Rango fuera de soluciones | `"000"` | [1, 50) | ✗ Sin solución — PASS ✅ |
| 3 | Prefijo medio, rango grande | `"0000"` | [0, 10.000.000) | ✓ nonce=80.281 — PASS ✅ |
| 4 | Rango chico, prefijo largo | `"00000"` | [0, 10.000) | ✗ Sin solución — PASS ✅ |
| 5 | Rango acotado, prefijo medio | `"0000"` | [5.000.000, 15.000.000) | ✓ nonce=5.074.365 — PASS ✅ |

Todos los tests pasaron correctamente. Los casos 2 y 4 verifican que el programa reporta correctamente la ausencia de solución cuando el rango es demasiado pequeño para el prefijo buscado.

## Cierre de etapa — Comparativa GPU vs CPU

Se ejecutó un benchmark comparativo entre la implementación GPU (CUDA, T4) y la implementación CPU (Python, `hashlib.md5`) para prefijos de longitud 1 a 6.

| Prefijo | CPU (kH/s) | GPU (MH/s) | Speedup | Confiable |
|---|---|---|---|---|
| `"0"` | 75.4 | 315.5 | ×4.182 | ❌ |
| `"00"` | 814.2 | 753.0 | ×925 | ⚠️ |
| `"000"` | 901.8 | 751.9 | ×834 | ⚠️ |
| `"0000"` | 1.037.8 | 355.5 | ×343 | ⚠️ |
| `"00000"` | 1.025.1 | 243.3 | ×237 | ✅ |
| `"000000"` | 1.003.5 | 157.6 | ×157 | ✅ |

![hit7_compare.png](../imagenes/hit7_compare.png)

### Salida benchmark CPU

```
Prefijo    |      Nonce |  Tiempo(s) |     kH/s
--------------------------------------------------
"0"        |          3 |      0.000 |     75.4
"00"       |        129 |      0.000 |    814.2
"000"      |      2,335 |      0.003 |    901.8
"0000"     |     80,281 |      0.077 |   1037.8
"00000"    |    104,442 |      0.102 |   1025.1
"000000"   |  1,313,728 |      1.309 |   1003.5
```

### Salida benchmark GPU

```
Prefijo    | Nonce           | Hash                             | Tiempo(s)  | MH/s
-----------+-----------------+----------------------------------+------------+-------
"0"        |           16170 | 00526c13a15e39a94c681f9e6998c2d1 |      0.001 | 315.5
"00"       |           14087 | 0067f1a1a7cb6fe0fba212e1f5e9d232 |      0.000 | 753.0
"000"      |           31707 | 00069c32914f96f5e30e030972b20b26 |      0.000 | 751.9
"0000"     |           80281 | 00002934705636956194e2d07c756047 |      0.001 | 355.5
"00000"    |          104442 | 00000236d79f329db027af3cd2f9119b |      0.001 | 243.3
"000000"   |         1313728 | 0000005b066fc3148d5ddc7f256ee9e9 |      0.010 | 157.6
"0000000"  |        51004498 | 00000000b74f955fbe5344b4a27ffb94 |      0.382 | 133.6
"00000000" |        51004498 | 00000000b74f955fbe5344b4a27ffb94 |      0.384 | 133.1
"000000000"|       684643517 | 00000000076a2fe286fd03509c7d056d |      5.264 | 130.1
"0000000000"|              - | -------------------------------- |    120.001 | 131.2  [TIMEOUT >120s]
```

> **Nota sobre el prefijo `"0"`:** el speedup de ×4.370 no refleja la velocidad real de cómputo. La CPU encontró la solución en `nonce=3` (solo 4 hashes), por lo que el tiempo medido es prácticamente cero y el cálculo de kH/s es inestable. La GPU, por su parte, siempre lanza un batch mínimo de 262.144 threads aunque la solución aparezca en los primeros nonces. Ambas mediciones son dominadas por overhead (intérprete Python en CPU, inicialización CUDA en GPU) y no por velocidad de hashing sostenida.

Los valores confiables son los de prefijos largos (`"00000"` y `"000000"`), donde ambas implementaciones computan millones de hashes y el overhead es despreciable frente al tiempo total. Allí el speedup real es de **149 a ×228**.

La CPU alcanza ~1 MH/s con `hashlib` (implementación en C subyacente), mientras que la GPU T4 corre a ~130-300 MH/s con nuestra implementación CUDA. La diferencia se reduce en prefijos largos porque las constantes MD5 almacenadas como arrays locales dentro del kernel generan presión en la caché L1, reduciendo el throughput por debajo del pico teórico de la T4.

