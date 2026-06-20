/**
 * md5.cuh — Implementación de MD5 ejecutable en GPU (device code)
 *
 * Basado en RFC 1321.
 * Soporta mensajes de hasta 119 bytes (2 bloques de 64 bytes).
 * Incluir este header en todos los hits que necesiten calcular MD5.
 */

#ifndef MD5_CUH
#define MD5_CUH

#include <stdint.h>

#define MD5_ROTL(x, n) (((x) << (n)) | ((x) >> (32 - (n))))

// ─── Funciones device ─────────────────────────────────────────────────────────

/**
 * Calcula MD5 de un mensaje en la GPU.
 * @param msg     Puntero al mensaje (en memoria de device)
 * @param len     Longitud del mensaje en bytes (máx 119)
 * @param digest  Buffer de salida de 16 bytes
 */
__device__ void md5_device(const uint8_t* msg, uint32_t len, uint8_t* digest) {
    // Constantes MD5 — definidas localmente para garantizar acceso correcto en device
    // (evita el problema de __device__ static const en headers con múltiples .cu)
    const uint32_t S[64] = {
         7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,  7, 12, 17, 22,
         5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,  5,  9, 14, 20,
         4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,  4, 11, 16, 23,
         6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21,  6, 10, 15, 21
    };
    const uint32_t T[64] = {
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
        0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
        0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
        0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
        0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
        0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
        0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
        0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
        0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
        0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
        0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
        0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
        0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
        0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391
    };

    // Estado inicial (magic numbers del estándar MD5)
    uint32_t a0 = 0x67452301;
    uint32_t b0 = 0xefcdab89;
    uint32_t c0 = 0x98badcfe;
    uint32_t d0 = 0x10325476;

    // Buffer con padding (máx 2 bloques = 128 bytes)
    uint8_t buf[128];
    uint32_t padded_len;

    // Copiar mensaje
    for (uint32_t i = 0; i < len; i++) buf[i] = msg[i];

    // Byte de padding obligatorio (0x80)
    buf[len] = 0x80;

    // Determinar cuántos ceros agregar
    uint32_t zero_bytes;
    if (len < 56) {
        zero_bytes = 55 - len;
        padded_len = 64;
    } else {
        zero_bytes = 119 - len;
        padded_len = 128;
    }
    for (uint32_t i = 0; i < zero_bytes; i++) buf[len + 1 + i] = 0x00;

    // Longitud del mensaje original en bits (little-endian, 64 bits)
    uint64_t bit_len = (uint64_t)len * 8;
    for (int i = 0; i < 8; i++)
        buf[padded_len - 8 + i] = (uint8_t)(bit_len >> (8 * i));

    // Procesar cada bloque de 64 bytes
    for (uint32_t block = 0; block < padded_len; block += 64) {
        // Interpretar bloque como 16 enteros de 32 bits (little-endian)
        uint32_t M[16];
        for (int i = 0; i < 16; i++) {
            M[i] = (uint32_t)buf[block + 4*i]
                 | ((uint32_t)buf[block + 4*i + 1] << 8)
                 | ((uint32_t)buf[block + 4*i + 2] << 16)
                 | ((uint32_t)buf[block + 4*i + 3] << 24);
        }

        uint32_t A = a0, B = b0, C = c0, D = d0;

        for (int i = 0; i < 64; i++) {
            uint32_t F, g;
            if (i < 16) {
                F = (B & C) | (~B & D);
                g = i;
            } else if (i < 32) {
                F = (D & B) | (~D & C);
                g = (5*i + 1) % 16;
            } else if (i < 48) {
                F = B ^ C ^ D;
                g = (3*i + 5) % 16;
            } else {
                F = C ^ (B | ~D);
                g = (7*i) % 16;
            }

            uint32_t temp = D;
            D = C;
            C = B;
            B = B + MD5_ROTL(A + F + T[i] + M[g], S[i]);
            A = temp;
        }

        a0 += A;
        b0 += B;
        c0 += C;
        d0 += D;
    }

    // Serializar resultado en little-endian
    digest[0]  =  a0        & 0xff;  digest[1]  = (a0 >>  8) & 0xff;
    digest[2]  = (a0 >> 16) & 0xff;  digest[3]  = (a0 >> 24) & 0xff;
    digest[4]  =  b0        & 0xff;  digest[5]  = (b0 >>  8) & 0xff;
    digest[6]  = (b0 >> 16) & 0xff;  digest[7]  = (b0 >> 24) & 0xff;
    digest[8]  =  c0        & 0xff;  digest[9]  = (c0 >>  8) & 0xff;
    digest[10] = (c0 >> 16) & 0xff;  digest[11] = (c0 >> 24) & 0xff;
    digest[12] =  d0        & 0xff;  digest[13] = (d0 >>  8) & 0xff;
    digest[14] = (d0 >> 16) & 0xff;  digest[15] = (d0 >> 24) & 0xff;
}

/**
 * Convierte 16 bytes de digest en string hexadecimal de 32 chars + null terminator.
 */
__device__ void md5_hex(const uint8_t* digest, char* hex) {
    const char* HEX = "0123456789abcdef";
    for (int i = 0; i < 16; i++) {
        hex[2*i]   = HEX[digest[i] >> 4];
        hex[2*i+1] = HEX[digest[i] & 0xf];
    }
    hex[32] = '\0';
}

/**
 * Verifica si el hash (en hex) empieza con el prefijo dado.
 */
__device__ bool md5_check_prefix(const char* hex, const char* prefix, int prefix_len) {
    for (int i = 0; i < prefix_len; i++) {
        if (hex[i] != prefix[i]) return false;
    }
    return true;
}

/**
 * Convierte uint64 a string ASCII decimal. Devuelve longitud.
 */
__device__ int uint64_to_str(uint64_t n, char* buf) {
    if (n == 0) { buf[0] = '0'; return 1; }
    char tmp[20];
    int len = 0;
    while (n > 0) { tmp[len++] = '0' + (int)(n % 10); n /= 10; }
    // Invertir
    for (int i = 0; i < len; i++) buf[i] = tmp[len - 1 - i];
    return len;
}

#endif // MD5_CUH
