/**
 * hit4_md5_hash.cu — Calcula MD5 de un string usando la GPU
 *
 * Compilar:  nvcc hit4_md5_hash.cu -o hit4_md5_hash
 * Ejecutar:  ./hit4_md5_hash "hello world"
 *
 * Verificar con:
 *   echo -n "hello world" | md5sum
 *   → 5eb63bbbe01eeed093cb22bb8f5acdc3  ✓
 */

#include <stdio.h>
#include <string.h>
#include <cuda_runtime.h>
#include "md5.cuh"

// ─── Kernel ───────────────────────────────────────────────────────────────────

/**
 * Un solo thread calcula el MD5 del input y escribe el resultado en hex.
 * (En Hit #5 escalaremos a millones de threads en paralelo.)
 */
__global__ void hash_kernel(const char* input, int len, char* output_hex) {
    if (threadIdx.x == 0 && blockIdx.x == 0) {
        uint8_t digest[16];
        md5_device((const uint8_t*)input, (uint32_t)len, digest);
        md5_hex(digest, output_hex);
    }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

int main(int argc, char* argv[]) {
    printf("==============================================\n");
    printf("  Hit #4 — MD5 Hash con CUDA\n");
    printf("==============================================\n\n");

    if (argc < 2) {
        printf("Uso: %s <string>\n", argv[0]);
        printf("Ej:  %s \"hello world\"\n", argv[0]);
        return 1;
    }

    const char* input = argv[1];
    int len = (int)strlen(input);

    printf("Input:  \"%s\"\n", input);
    printf("Largo:  %d bytes\n\n", len);

    // ── Memoria en GPU ────────────────────────────────────────────────────────
    char* d_input;
    char* d_hex;

    cudaMalloc((void**)&d_input, len + 1);
    cudaMalloc((void**)&d_hex, 33);  // 32 chars hex + null terminator

    cudaMemcpy(d_input, input, len + 1, cudaMemcpyHostToDevice);

    // ── Lanzar kernel ─────────────────────────────────────────────────────────
    hash_kernel<<<1, 1>>>(d_input, len, d_hex);

    cudaError_t err = cudaDeviceSynchronize();
    if (err != cudaSuccess) {
        printf("Error CUDA: %s\n", cudaGetErrorString(err));
        return 1;
    }

    // ── Leer resultado ────────────────────────────────────────────────────────
    char hex[33];
    cudaMemcpy(hex, d_hex, 33, cudaMemcpyDeviceToHost);

    printf("MD5:    %s\n", hex);
    printf("\n(Verificar con: echo -n \"%s\" | md5sum)\n", input);

    cudaFree(d_input);
    cudaFree(d_hex);
    return 0;
}
