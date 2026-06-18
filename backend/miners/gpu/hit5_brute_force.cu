/**
 * hit5_brute_force.cu — Minería por fuerza bruta con CUDA
 *
 * Encuentra un nonce tal que MD5(data + nonce) empiece con el prefijo dado.
 * Cada thread de GPU prueba un nonce distinto en paralelo.
 *
 * Compilar:  nvcc hit5_brute_force.cu -o hit5_brute_force
 * Ejecutar:  ./hit5_brute_force "ticketchain:block:42:" "0000"
 *
 *   Argumento 1: data string (base del hash, simula datos del bloque)
 *   Argumento 2: prefijo requerido en el hash resultante (ej: "00", "0000")
 */

#include <stdio.h>
#include <string.h>
#include <stdint.h>
#include <time.h>
#include <cuda_runtime.h>
#include "md5.cuh"

// ─── Configuración de lanzamiento ─────────────────────────────────────────────
#define THREADS_PER_BLOCK  256
#define BLOCKS_PER_LAUNCH  1024
// Total de nonces probados por lanzamiento: 256 * 1024 = 262.144
#define NONCES_PER_LAUNCH  (THREADS_PER_BLOCK * BLOCKS_PER_LAUNCH)

// ─── Kernel de minería ────────────────────────────────────────────────────────

/**
 * Cada thread prueba el nonce: nonce_start + blockIdx.x * blockDim.x + threadIdx.x
 * Construye el mensaje: data + str(nonce), calcula MD5 y compara prefijo.
 * Si encuentra solución, usa atomicCAS para reclamarla (solo uno gana).
 */
__global__ void mine_kernel(
    const char*  data,          // datos del bloque (string base)
    int          data_len,      // longitud de data
    const char*  prefix,        // prefijo requerido (ej: "0000")
    int          prefix_len,    // longitud del prefijo
    uint64_t     nonce_start,   // primer nonce de este lanzamiento
    uint64_t*    found_nonce,   // [out] nonce encontrado
    char*        found_hash,    // [out] hash resultante (33 bytes)
    int*         found_flag     // [in/out] flag atómico: 0=no encontrado, 1=encontrado
) {
    // Salida temprana si otro thread ya encontró la solución
    if (atomicAdd(found_flag, 0) != 0) return;

    uint64_t idx   = (uint64_t)blockIdx.x * blockDim.x + threadIdx.x;
    uint64_t nonce = nonce_start + idx;

    // ── Construir mensaje: data + str(nonce) ──────────────────────────────────
    char message[128];
    int  msg_len = data_len;

    for (int i = 0; i < data_len; i++) message[i] = data[i];

    char nonce_str[21];
    int  nonce_len = uint64_to_str(nonce, nonce_str);

    for (int i = 0; i < nonce_len; i++) message[msg_len + i] = nonce_str[i];
    msg_len += nonce_len;

    // ── Calcular MD5 ──────────────────────────────────────────────────────────
    uint8_t digest[16];
    char    hex[33];
    md5_device((uint8_t*)message, (uint32_t)msg_len, digest);
    md5_hex(digest, hex);

    // ── Verificar prefijo ─────────────────────────────────────────────────────
    if (md5_check_prefix(hex, prefix, prefix_len)) {
        // atomicCAS: si found_flag es 0, lo pone en 1 y devuelve 0 (éxito)
        if (atomicCAS(found_flag, 0, 1) == 0) {
            *found_nonce = nonce;
            for (int i = 0; i < 33; i++) found_hash[i] = hex[i];
        }
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    printf("==============================================\n");
    printf("  Hit #5 — Minería por Fuerza Bruta (GPU)\n");
    printf("==============================================\n\n");

    if (argc < 3) {
        printf("Uso: %s <data> <prefijo>\n", argv[0]);
        printf("Ej:  %s \"ticketchain:block:42:\" \"0000\"\n", argv[0]);
        return 1;
    }

    const char* data       = argv[1];
    const char* prefix     = argv[2];
    int         data_len   = (int)strlen(data);
    int         prefix_len = (int)strlen(prefix);

    printf("Data:    \"%s\"\n", data);
    printf("Prefijo: \"%s\" (%d caracteres)\n\n", prefix, prefix_len);

    // ── Memoria en GPU ────────────────────────────────────────────────────────
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

    // ── Bucle de minería ──────────────────────────────────────────────────────
    struct timespec t_start, t_end;
    clock_gettime(CLOCK_MONOTONIC, &t_start);

    uint64_t nonce_start   = 0;
    int      found_flag    = 0;
    uint64_t total_hashes  = 0;

    printf("Minando");
    fflush(stdout);

    while (!found_flag) {
        mine_kernel<<<BLOCKS_PER_LAUNCH, THREADS_PER_BLOCK>>>(
            d_data, data_len,
            d_prefix, prefix_len,
            nonce_start,
            d_found_nonce,
            d_found_hash,
            d_found_flag
        );
        cudaDeviceSynchronize();

        cudaMemcpy(&found_flag, d_found_flag, sizeof(int), cudaMemcpyDeviceToHost);
        nonce_start  += NONCES_PER_LAUNCH;
        total_hashes += NONCES_PER_LAUNCH;

        printf("."); fflush(stdout);
    }

    clock_gettime(CLOCK_MONOTONIC, &t_end);
    double elapsed = (t_end.tv_sec - t_start.tv_sec)
                   + (t_end.tv_nsec - t_start.tv_nsec) / 1e9;

    // ── Leer resultado ────────────────────────────────────────────────────────
    uint64_t found_nonce;
    char     found_hash[33];
    cudaMemcpy(&found_nonce, d_found_nonce, sizeof(uint64_t), cudaMemcpyDeviceToHost);
    cudaMemcpy(found_hash,   d_found_hash,  33,               cudaMemcpyDeviceToHost);

    printf("\n\n✓ ¡Solución encontrada!\n");
    printf("  Nonce:        %llu\n", (unsigned long long)found_nonce);
    printf("  Hash:         %s\n",   found_hash);
    printf("  Total hashes: %llu\n", (unsigned long long)total_hashes);
    printf("  Tiempo:       %.3f segundos\n", elapsed);
    printf("  Hash rate:    %.2f MH/s\n\n", total_hashes / elapsed / 1e6);

    // ── Verificación en CPU ───────────────────────────────────────────────────
    printf("(Para verificar: el mensaje fue \"%s%llu\")\n",
           data, (unsigned long long)found_nonce);

    cudaFree(d_data);
    cudaFree(d_prefix);
    cudaFree(d_found_nonce);
    cudaFree(d_found_hash);
    cudaFree(d_found_flag);
    return 0;
}
