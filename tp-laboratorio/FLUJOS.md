# TicketChain — Flujos del sistema

---

## Actores / Módulos

| Módulo | Tipo | Responsabilidad |
|---|---|---|
| **API Gateway** | Servicio HTTP | Punto de entrada único. Autenticación, rate limiting, ruteo. |
| **Event Registry** | Servicio HTTP | CRUD de creadores y eventos. Genera el bloque génesis al crear un evento. |
| **Transaction API** | Servicio HTTP | Recibe compras y reventas vía HTTP. Valida ownership y precio contra Redis antes de encolar. |
| **NCT** (Nodo Coordinador) | Worker | Consume txs de la cola, acumula, forma bloques candidatos, los publica para minería y persiste el bloque confirmado en Redis. |
| **TrP** (Transaction Pool) | Worker | Consume bloques candidatos, divide el espacio de nonces en rangos y los asigna a los workers disponibles (según keepalives). |
| **Worker GPU** | Minero | Mina con CUDA (C/C++). Recibe un rango de nonces, prueba hasta encontrar el hash válido, publica el resultado. |
| **Worker CPU** | Minero | Fallback en Python. Misma interfaz que Worker GPU, se levanta si no hay GPU disponible. |
| **Access Control API** | Servicio HTTP | Valida una entrada en la puerta consultando el índice de ownership en Redis. No recorre la cadena. |
| **Status API** | Servicio HTTP | Health check de todos los servicios (requerido por el TP). |
| **RabbitMQ** | Broker | Un exchange por evento activo. Desacopla todos los servicios asincrónicos. |
| **Redis** | Base de datos | Persiste la blockchain (`blockchain:{evento_id}`) y el índice de ownership (`ownership:{evento_id}:{entrada_id}`). |

---

## Flujo 1 — Reventa: request HTTP

```
Usuario
  │
  │  POST /transfer  { from, to, evento_id, entrada_id, precio }
  ▼
API Gateway
  │  valida API key / token
  ▼
Transaction API
  │  GET ownership:lp-rolling-stones-2026-10-15:SECTOR-A-FILA-12-ASIENTO-5
  │  → Redis devuelve "usuario_0x4f3a"  ✓ es el dueño
  │
  │  GET blockchain:lp-rolling-stones-2026-10-15  LINDEX 0
  │  → lee bloque génesis → precio_max = 1.5x → 10000 * 1.5 = 15000  ✓
  │
  │  PUBLISH → cola txs (RabbitMQ)
  │
  └─► HTTP 202 Accepted  (encolada, aún no confirmada)
```

---

## Flujo 2 — Reventa: mensajes en las colas

### Cola `txs` — Transaction API → NCT

```json
{
  "from":       "usuario_0x4f3a",
  "to":         "usuario_0x9c2b",
  "evento_id":  "lp-rolling-stones-2026-10-15",
  "entrada_id": "SECTOR-A-FILA-12-ASIENTO-5",
  "precio":     15000,
  "timestamp":  "2026-05-29T20:00:00Z"
}
```

El NCT acumula N txs o espera un timeout. Luego lee el último hash de Redis y arma el bloque candidato.

---

### Cola `mining_task` — NCT → TrP

```json
{
  "block_candidate": {
    "index":      4,
    "prev_hash":  "00007e4d2f1a...",
    "timestamp":  "2026-05-29T20:00:05Z",
    "data": {
      "type": "transactions",
      "txs": [
        { "from": "usuario_0x4f3a", "to": "usuario_0x9c2b", "entrada_id": "SECTOR-A-FILA-12-ASIENTO-5", "precio": 15000 },
        { "from": "usuario_0xaa11", "to": "usuario_0xbb22", "entrada_id": "SECTOR-B-FILA-3-ASIENTO-1",  "precio": 12000 }
      ]
    }
  },
  "difficulty": 4
}
```

---

### Cola `nonce_range` — TrP → Workers

TrP sabe qué workers están vivos por keepalives. Publica un mensaje por worker:

```json
// → worker-gpu-1
{
  "block_candidate": { "index": 4, "prev_hash": "00007e4d...", "data": { ... } },
  "range_start": 0,
  "range_end":   1000000,
  "worker_id":   "worker-gpu-1"
}

// → worker-cpu-1
{
  "block_candidate": { "index": 4, "prev_hash": "00007e4d...", "data": { ... } },
  "range_start": 1000000,
  "range_end":   2000000,
  "worker_id":   "worker-cpu-1"
}
```

---

### Cola `mining_result` — Workers → NCT

**Si encontró el nonce:**
```json
{
  "block_index": 4,
  "worker_id":   "worker-gpu-1",
  "found":       true,
  "nonce":       482910,
  "hash":        "00003f9a7c..."
}
```

**Si no encontró en su rango:**
```json
{
  "block_index": 4,
  "worker_id":   "worker-cpu-1",
  "found":       false
}
```

---

### Confirmación — NCT persiste en Redis

El NCT recibe el primer `found: true`, verifica `MD5(bloque + nonce) == hash` y escribe:

```
RPUSH  blockchain:lp-rolling-stones-2026-10-15
       '{"index":4,"prev_hash":"00007e4d...","nonce":482910,"hash":"00003f9a7c...","data":{...}}'

SET    ownership:lp-rolling-stones-2026-10-15:SECTOR-A-FILA-12-ASIENTO-5
       "usuario_0x9c2b"
```

Los resultados `found: false` o los que llegan tarde se descartan.

---

## Resumen visual

```
Usuario
  │  HTTP POST /transfer
  ▼
API Gateway ──► Transaction API
                  │  valida en Redis (ownership + precio_max)
                  │
                  └──[txs]──► NCT
                                │  acumula txs, lee prev_hash de Redis
                                │
                                └──[mining_task]──► TrP
                                                      │  divide nonces según keepalives
                                                      │
                                          ┌───────────┴───────────┐
                                          ▼                       ▼
                                     Worker GPU             Worker CPU
                                     (C/C++ CUDA)           (Python)
                                          │                       │
                                          └───────────┬───────────┘
                                                      │
                                               [mining_result]
                                                      │
                                                      ▼
                                                     NCT
                                                      │  verifica hash
                                                      ▼
                                                    Redis
                                         RPUSH blockchain:{evento_id}
                                         SET   ownership:{evento_id}:{entrada_id}
```
