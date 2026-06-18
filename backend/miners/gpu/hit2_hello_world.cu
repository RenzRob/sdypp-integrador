/**
 * hit2_hello_world.cu — Hola Mundo en CUDA
 *
 * Compilar:  nvcc hit2_hello_world.cu -o hit2_hello_world
 * Ejecutar:  ./hit2_hello_world
 *
 * Muestra info de la GPU y lanza threads que imprimen desde el device.
 */

#include <stdio.h>
#include <cuda_runtime.h>

// ─── Kernel ───────────────────────────────────────────────────────────────────

__global__ void hello_kernel() {
    // Cada thread se identifica con su block e índice dentro del block
    printf("  Hola desde GPU! | Block %2d | Thread %2d\n",
           blockIdx.x, threadIdx.x);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

int main() {
    printf("==============================================\n");
    printf("  Hit #2 — Hola Mundo en CUDA\n");
    printf("==============================================\n\n");

    // ── Info del dispositivo ──────────────────────────────────────────────────
    int device_count;
    cudaGetDeviceCount(&device_count);
    printf("GPUs disponibles: %d\n\n", device_count);

    for (int d = 0; d < device_count; d++) {
        cudaDeviceProp prop;
        cudaGetDeviceProperties(&prop, d);

        printf("--- GPU %d ---\n", d);
        printf("  Nombre:               %s\n", prop.name);
        printf("  Compute Capability:   %d.%d\n", prop.major, prop.minor);
        printf("  Multiprocesadores SM: %d\n", prop.multiProcessorCount);
        printf("  Memoria Global:       %.2f GB\n", prop.totalGlobalMem / 1e9);
        printf("  Memoria Compartida:   %zu KB por bloque\n", prop.sharedMemPerBlock / 1024);
        printf("  Max Threads / Bloque: %d\n", prop.maxThreadsPerBlock);
        printf("  Warp Size:            %d\n\n", prop.warpSize);
    }

    // ── Lanzamiento del kernel ────────────────────────────────────────────────
    // 3 bloques, 4 threads cada uno → 12 threads en total
    int num_blocks  = 3;
    int num_threads = 4;

    printf("Lanzando kernel con %d bloques x %d threads = %d threads totales\n\n",
           num_blocks, num_threads, num_blocks * num_threads);

    hello_kernel<<<num_blocks, num_threads>>>();

    // Esperar que todos los threads terminen antes de salir
    cudaError_t err = cudaDeviceSynchronize();
    if (err != cudaSuccess) {
        printf("Error CUDA: %s\n", cudaGetErrorString(err));
        return 1;
    }

    printf("\n¡Listo!\n");
    return 0;
}
