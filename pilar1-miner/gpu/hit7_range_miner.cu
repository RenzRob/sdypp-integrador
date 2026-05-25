/**
 * hit7_range_miner.cu — Minería con rango de nonces acotado [range_start, range_end)
 *
 * Este es el corazón del worker GPU en el sistema distribuido (Pilar 2).
 * El Transaction Pool (TrP) divide el espacio de búsqueda en rangos y
 * le asigna a cada worker un rango distinto para buscar en paralelo.
 *
 * Compilar:  nvcc hit7_range_miner.cu -o hit7_range_miner
 * Ejecutar:  ./hit7_range_miner <data> <prefijo> <range_start> <range_end>
 *
 * Ejemplo (buscar en [0, 1000000)):
 *   ./hit7_range_miner "ticketchain:block:42:" "000" 0 1000000
 *
 * Ejemplo (worker 2 de 3, en espacio de 3M nonces):
 *   ./hit7_range_miner "ticketchain:block:42:" "000" 1000000 2000000
 *
 * Si no encuentra nada en el rango, informa y sale con código 1.
 * Si encuentra, imprime el nonce y el hash, y sale con código 0.
 */

#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <stdlib.h>
#include <time.h>
#include <cuda_runtime.h>
#include "md5.cuh"

#define THREADS_PER_BLOCK  256
#define BLOCKS_PER_LAUNCH  1024
#define NONCES_PER_LAUNCH  (THREADS_PER_BLOCK * BLOCKS_PER_LAUNCH)

// ─── Kernel ───────────────────────────────────────────────────────────────────

__global__ void range_mine_kernel(
    const char* data, int data_len,
    const char* prefix, int prefix_len,
    uint64_t nonce_start,   // primer nonce de este batch
    uint64_t batch_size,    // cuántos nonces prueba este batch
    uint64_t* found_nonce,
    char*     found_hash,
    int*      found_flag
) {
    if (atomicAdd(found_flag, 0) != 0) return;

    uint64_t idx = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
    if (idx >= batch_size) return;  // ← respeta el límite del rango

    uint64_t nonce = nonce_start + idx;

    // Construir mensaje: data + str(nonce)
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

// ─── Main ─────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    printf("==============================================\n");
    printf("  Hit #7 — Minería con Rango [start, end)\n");
    printf("==============================================\n\n");

    if (argc < 5) {
        printf("Uso: %s <data> <prefijo> <range_start> <range_end>\n", argv[0]);
        printf("Ej:  %s \"ticketchain:block:42:\" \"000\" 0 5000000\n", argv[0]);
        return 1;
    }

    const char* data        = argv[1];
    const char* prefix      = argv[2];
    uint64_t    range_start = (uint64_t)strtoull(argv[3], NULL, 10);
    uint64_t    range_end   = (uint64_t)strtoull(argv[4], NULL, 10);
    int         data_len    = (int)strlen(data);
    int         prefix_len  = (int)strlen(prefix);

    if (range_start >= range_end) {
        printf("ERROR: range_start debe ser menor que range_end\n");
        return 1;
    }

    uint64_t range_size = range_end - range_start;

    printf("Data:         \"%s\"\n",   data);
    printf("Prefijo:      \"%s\"\n",   prefix);
    printf("Rango:        [%llu, %llu)\n",
           (unsigned long long)range_start,
           (unsigned long long)range_end);
    printf("Nonces a probar: %llu\n\n", (unsigned long long)range_size);

    // ── Memoria GPU ───────────────────────────────────────────────────────────
    char*     d_data;
    char*     d_prefix;
    uint64_t* d_found_nonce;
    char*     d_found_hash;
    int*      d_found_flag;

    cudaMalloc((void**)&d_data,        data_len + 1);
    cudaMalloc((void**)&d_prefix,      prefix_len + 1);
    cudaMalloc((void**)&d_found_nonce, sizeof(uint64_t));
    cudaMalloc((void**)&d_found_hash,  33);
    cudaMalloc((void**)&d_found_flag,  sizeof(int));

    cudaMemcpy(d_data,   data,   data_len + 1,   cudaMemcpyHostToDevice);
    cudaMemcpy(d_prefix, prefix, prefix_len + 1, cudaMemcpyHostToDevice);
    cudaMemset(d_found_flag,  0, sizeof(int));
    cudaMemset(d_found_nonce, 0, sizeof(uint64_t));

    // ── Bucle de minería dentro del rango ─────────────────────────────────────
    struct timespec t_start, t_end;
    clock_gettime(CLOCK_MONOTONIC, &t_start);

    uint64_t nonce_start  = range_start;
    uint64_t total_hashes = 0;
    int      found_flag   = 0;

    printf("Buscando");
    fflush(stdout);

    while (!found_flag && nonce_start < range_end) {
        // Calcular cuántos nonces quedan en el rango
        uint64_t remaining  = range_end - nonce_start;
        uint64_t batch_size = (remaining < NONCES_PER_LAUNCH) ? remaining : NONCES_PER_LAUNCH;

        // Calcular bloques necesarios para cubrir batch_size threads
        int blocks = (int)((batch_size + THREADS_PER_BLOCK - 1) / THREADS_PER_BLOCK);

        range_mine_kernel<<<blocks, THREADS_PER_BLOCK>>>(
            d_data, data_len,
            d_prefix, prefix_len,
            nonce_start, batch_size,
            d_found_nonce, d_found_hash, d_found_flag
        );
        cudaDeviceSynchronize();

        cudaMemcpy(&found_flag, d_found_flag, sizeof(int), cudaMemcpyDeviceToHost);
        nonce_start  += batch_size;
        total_hashes += batch_size;

        printf("."); fflush(stdout);
    }

    clock_gettime(CLOCK_MONOTONIC, &t_end);
    double elapsed = (t_end.tv_sec - t_start.tv_sec)
                   + (t_end.tv_nsec - t_start.tv_nsec) / 1e9;

    printf("\n\n");

    // ── Resultado ─────────────────────────────────────────────────────────────
    if (!found_flag) {
        printf("✗ No se encontró solución en el rango [%llu, %llu)\n",
               (unsigned long long)range_start,
               (unsigned long long)range_end);
        printf("  Hashes probados: %llu\n",  (unsigned long long)total_hashes);
        printf("  Tiempo:          %.3f s\n", elapsed);
        printf("  Hash rate:       %.2f MH/s\n", total_hashes / elapsed / 1e6);

        cudaFree(d_data); cudaFree(d_prefix);
        cudaFree(d_found_nonce); cudaFree(d_found_hash); cudaFree(d_found_flag);
        return 1;  // código de salida 1 → el NCT sabrá que este rango no tuvo solución
    }

    uint64_t found_nonce;
    char     found_hash[33];
    cudaMemcpy(&found_nonce, d_found_nonce, sizeof(uint64_t), cudaMemcpyDeviceToHost);
    cudaMemcpy(found_hash,   d_found_hash,  33,               cudaMemcpyDeviceToHost);

    printf("✓ ¡Solución encontrada!\n");
    printf("  Nonce:        %llu\n",  (unsigned long long)found_nonce);
    printf("  Hash:         %s\n",    found_hash);
    printf("  Hashes prob.: %llu\n",  (unsigned long long)total_hashes);
    printf("  Tiempo:       %.3f s\n", elapsed);
    printf("  Hash rate:    %.2f MH/s\n\n", total_hashes / elapsed / 1e6);

    // Output limpio para que el NCT pueda parsear fácilmente (stdout)
    printf("RESULT:NONCE=%llu:HASH=%s\n",
           (unsigned long long)found_nonce, found_hash);

    cudaFree(d_data); cudaFree(d_prefix);
    cudaFree(d_found_nonce); cudaFree(d_found_hash); cudaFree(d_found_flag);
    return 0;
}
