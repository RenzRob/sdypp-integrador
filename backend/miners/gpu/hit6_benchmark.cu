/**
 * hit6_benchmark.cu — Benchmark: tiempo vs longitud de prefijo
 *
 * Mide cuánto tarda encontrar un nonce válido para prefijos de longitud
 * 1 a MAX_PREFIX_LEN, y calcula el hash rate de la GPU.
 *
 * Compilar:  nvcc hit6_benchmark.cu -o hit6_benchmark
 * Ejecutar:  ./hit6_benchmark "ticketchain:block:42:"
 *
 * Salida esperada (ejemplo en T4):
 *   Prefijo | Nonce      | Hash                             | Tiempo   | MH/s
 *   0       |          0 | d41d8cd...                       | 0.001s   | 262.1
 *   00      |         17 | 00f4e2b...                       | 0.001s   | 262.1
 *   000     |        ...
 *   ...
 */

#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <cuda_runtime.h>
#include "md5.cuh"

#define THREADS_PER_BLOCK  256
#define BLOCKS_PER_LAUNCH  1024
#define NONCES_PER_LAUNCH  (THREADS_PER_BLOCK * BLOCKS_PER_LAUNCH)

// Prefijo máximo a testear
#define MAX_PREFIX_LEN 12
// Timeout por prefijo en segundos (corta si tarda demasiado)
#define TIMEOUT_SEC    120

// ─── Kernel (igual que Hit #5, reutilizado aquí) ──────────────────────────────

__global__ void mine_kernel(
    const char* data, int data_len,
    const char* prefix, int prefix_len,
    uint64_t nonce_start,
    uint64_t* found_nonce, char* found_hash, int* found_flag
) {
    if (atomicAdd(found_flag, 0) != 0) return;

    uint64_t idx   = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
    uint64_t nonce = nonce_start + idx;

    char message[128];
    int  msg_len = data_len;
    for (int i = 0; i < data_len; i++) message[i] = data[i];
    char nonce_str[21];
    int  nonce_len = uint64_to_str(nonce, nonce_str);
    for (int i = 0; i < nonce_len; i++) message[msg_len + i] = nonce_str[i];
    msg_len += nonce_len;

    uint8_t digest[16];
    char    hex[33];
    md5_device((uint8_t*)message, (uint32_t)msg_len, digest);
    md5_hex(digest, hex);

    if (md5_check_prefix(hex, prefix, prefix_len)) {
        if (atomicCAS(found_flag, 0, 1) == 0) {
            *found_nonce = nonce;
            for (int i = 0; i < 33; i++) found_hash[i] = hex[i];
        }
    }
}

// ─── Función de minería para un prefijo dado ──────────────────────────────────

struct MineResult {
    uint64_t nonce;
    char     hash[33];
    double   elapsed_sec;
    uint64_t total_hashes;
    int      timed_out;   // 1 si se cortó por timeout
};

MineResult mine_with_prefix(
    const char* data, int data_len,
    const char* prefix, int prefix_len,
    char* d_data, char* d_prefix,
    uint64_t* d_found_nonce, char* d_found_hash, int* d_found_flag
) {
    cudaMemcpy(d_prefix, prefix, prefix_len + 1, cudaMemcpyHostToDevice);
    cudaMemset(d_found_flag,  0, sizeof(int));
    cudaMemset(d_found_nonce, 0, sizeof(uint64_t));

    struct timespec t_start, t_now, t_end;
    clock_gettime(CLOCK_MONOTONIC, &t_start);

    uint64_t nonce_start  = 0;
    uint64_t total_hashes = 0;
    int      found_flag   = 0;
    int      timed_out    = 0;

    while (!found_flag) {
        mine_kernel<<<BLOCKS_PER_LAUNCH, THREADS_PER_BLOCK>>>(
            d_data, data_len, d_prefix, prefix_len,
            nonce_start, d_found_nonce, d_found_hash, d_found_flag
        );
        cudaDeviceSynchronize();
        cudaMemcpy(&found_flag, d_found_flag, sizeof(int), cudaMemcpyDeviceToHost);
        nonce_start  += NONCES_PER_LAUNCH;
        total_hashes += NONCES_PER_LAUNCH;

        // Verificar timeout
        clock_gettime(CLOCK_MONOTONIC, &t_now);
        double elapsed = (t_now.tv_sec - t_start.tv_sec)
                       + (t_now.tv_nsec - t_start.tv_nsec) / 1e9;
        if (!found_flag && elapsed >= TIMEOUT_SEC) {
            timed_out = 1;
            break;
        }
    }

    clock_gettime(CLOCK_MONOTONIC, &t_end);

    MineResult r;
    r.timed_out    = timed_out;
    r.total_hashes = total_hashes;
    r.elapsed_sec  = (t_end.tv_sec - t_start.tv_sec) + (t_end.tv_nsec - t_start.tv_nsec) / 1e9;

    if (!timed_out) {
        cudaMemcpy(&r.nonce, d_found_nonce, sizeof(uint64_t), cudaMemcpyDeviceToHost);
        cudaMemcpy(r.hash,   d_found_hash,  33,               cudaMemcpyDeviceToHost);
    } else {
        r.nonce   = 0;
        r.hash[0] = '\0';
    }
    return r;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    printf("==============================================\n");
    printf("  Hit #6 — Benchmark: Tiempo vs Longitud de Prefijo\n");
    printf("==============================================\n\n");

    const char* data = (argc >= 2) ? argv[1] : "ticketchain:block:42:";
    int data_len = (int)strlen(data);

    printf("Data: \"%s\"\n\n", data);

    // ── Memoria GPU (se reutiliza entre iteraciones) ───────────────────────────
    char*     d_data;
    char*     d_prefix;
    uint64_t* d_found_nonce;
    char*     d_found_hash;
    int*      d_found_flag;

    cudaMalloc((void**)&d_data,        data_len + 1);
    cudaMalloc((void**)&d_prefix,      MAX_PREFIX_LEN + 2);
    cudaMalloc((void**)&d_found_nonce, sizeof(uint64_t));
    cudaMalloc((void**)&d_found_hash,  33);
    cudaMalloc((void**)&d_found_flag,  sizeof(int));

    cudaMemcpy(d_data, data, data_len + 1, cudaMemcpyHostToDevice);

    // ── Encabezado de tabla ────────────────────────────────────────────────────
    printf("%-10s | %-15s | %-34s | %-10s | %s\n",
           "Prefijo", "Nonce", "Hash", "Tiempo(s)", "MH/s");
    printf("%-10s-+-%-15s-+-%-34s-+-%-10s-+-%s\n",
           "----------", "---------------", "----------------------------------",
           "----------", "------");

    // ── Loop de benchmark ─────────────────────────────────────────────────────
    char prefix_buf[MAX_PREFIX_LEN + 1];
    memset(prefix_buf, '0', MAX_PREFIX_LEN);
    prefix_buf[MAX_PREFIX_LEN] = '\0';

    for (int plen = 1; plen <= MAX_PREFIX_LEN; plen++) {
        prefix_buf[plen] = '\0';  // prefijo de longitud plen (todo '0')

        MineResult r = mine_with_prefix(
            data, data_len, prefix_buf, plen,
            d_data, d_prefix, d_found_nonce, d_found_hash, d_found_flag
        );

        double mhs = r.total_hashes / r.elapsed_sec / 1e6;

        if (r.timed_out) {
            printf("\"%-8s\" | %15s | %s | %10.3f | %.1f  [TIMEOUT >%ds]\n",
                   prefix_buf, "-", "--------------------------------", r.elapsed_sec, mhs, TIMEOUT_SEC);
            fflush(stdout);
            prefix_buf[plen] = '0';
            break;  // no tiene sentido seguir con prefijos más largos
        }

        printf("\"%-8s\" | %15llu | %s | %10.3f | %.1f\n",
               prefix_buf,
               (unsigned long long)r.nonce,
               r.hash,
               r.elapsed_sec,
               mhs);
        fflush(stdout);

        prefix_buf[plen] = '0';  // restaurar para la siguiente iteración
    }

    printf("\n");

    // ── Análisis ──────────────────────────────────────────────────────────────
    printf("Observaciones:\n");
    printf("  - Cada caracter adicional en el prefijo multiplica el tiempo ~16x\n");
    printf("  - (El espacio de búsqueda crece 16x por cada hex char adicional)\n");
    printf("  - La GPU prueba miles de nonces en paralelo por eso escala bien\n");

    cudaFree(d_data);
    cudaFree(d_prefix);
    cudaFree(d_found_nonce);
    cudaFree(d_found_hash);
    cudaFree(d_found_flag);
    return 0;
}
