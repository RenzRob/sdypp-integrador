# TicketChain — Flujos del sistema

---

## Actores / Módulos

| Módulo | Tipo | Responsabilidad |
|---|---|---|
| **Nginx** | Reverse proxy | Punto de entrada único (`:80`). Rutea `/api/*` a los microservicios, sirve imágenes desde MinIO en `/images/`. |
| **Auth Service** | Node.js + Express `:3001` | Registro/login. Genera JWT con `{ sub, email, role, wallet_address }`. |
| **Event Registry** | Node.js + Express `:3002` | CRUD de eventos, carga imágenes a MinIO, genera bloque génesis al crear evento. |
| **Transaction API** | Node.js + Express `:3003` | Recibe compras y reventas vía HTTP. Publica en `exchange:transactions` (routing `tx.new`). |
| **Access Control API** | Node.js + Express `:3004` | Valida una entrada en la puerta consultando `ticket:{event_id}:{ticket_id}:owner` en Redis. |
| **Status API** | Node.js + Express `:3005` | Health check de todos los servicios (pings HTTP). |
| **NCT** | Python + FastAPI `:8000` | Consume `transactions_q` (`exchange:transactions`), acumula txs, forma bloques candidatos, publica tarea en `exchange:mining` (`task.global`) y persiste el bloque confirmado en Redis. Consume `nct_results_q` (`exchange:nct_results`) para recibir bloques resueltos. |
| **Mining Gateway** | Python + FastAPI `:8000` | Borde cross-cluster con mTLS. Expone `GET /next-task` (lee `mining_gateway_q`) y `POST /result` (publica en `exchange:nct_results`). Solo recibe llamadas salientes del TrP — no inicia conexión. |
| **TrP** (Transaction Pool) | Python + FastAPI | Corre en cluster del profe. Hace PULL al mining-gateway: `GET /next-task` con mTLS. Fragmenta el espacio de nonces y publica fragmentos en `exchange:mining_tasks` (`worker.task`). Consume resultados de `exchange:mining_results` (`result.global` y `keepalive.global`). Postea bloque resuelto al gateway con `POST /result`. |
| **Worker GPU** | C/C++ + CUDA | Consume `mining_tasks_q` (`worker.task`), mina el rango asignado, publica resultado en `exchange:mining_results` (`result.global`). Manda keepalives (`keepalive.global`) cada 5 s. |
| **Worker CPU** | Python | Igual que Worker GPU pero en CPU con hashlib. Fallback automático si no hay GPU. |
| **RabbitMQ (cluster-services)** | Broker | Exchanges: `transactions` (tx.new), `mining` (task.global), `nct_results` (nct.result). |
| **RabbitMQ (cluster-mining)** | Broker | Exchanges: `mining_tasks` (worker.task), `mining_results` (result.global, keepalive.global). |
| **Redis** | Base de datos | `blockchain:{event_id}` (lista de bloques), `ticket:{event_id}:{ticket_id}:owner`, `ticket:{event_id}:{ticket_id}:resales`. |
| **PostgreSQL** | Base de datos | Usuarios y sesiones. |
| **MinIO** | Object Storage | Imágenes de eventos, accesibles públicamente vía Nginx en `/images/`. |

---

## Flujo 1 — Compra / Reventa: request HTTP

```
Browser
  │
  │  POST /api/transactions/  { from_wallet, to_wallet, event_id, ticket_id, price, type }
  ▼
Nginx (:80)
  │  proxy_pass → transaction-api:3003
  ▼
Transaction API
  │  verifica JWT (wallet_address del token == from_wallet)
  │  valida ownership en Redis: GET ticket:{event_id}:{ticket_id}:owner
  │  publica en exchange:transactions  routing_key=tx.new
  │
  └─► HTTP 202 Accepted  (encolada, pendiente de confirmación en blockchain)
```

---

## Flujo 2 — Procesamiento de la transacción (cluster-services)

### Cola `transactions_q` — Transaction API → NCT

```json
{
  "tx_id":       "uuid",
  "type":        "resell",
  "from_wallet": "0x4f3a1c2b",
  "to_wallet":   "0x9c2baa11",
  "event_id":    "lp-rolling-stones-2026-10-15",
  "ticket_id":   "SECTOR-A-FILA-12-ASIENTO-5",
  "price":       15000,
  "timestamp":   "2026-05-29T20:00:00Z"
}
```

El NCT acumula hasta `MAX_TX_PER_BLOCK` txs o espera `BLOCK_TIMEOUT` segundos.
Luego lee el último hash de Redis (`LINDEX blockchain:{event_id} -1`) y arma el bloque candidato.

---

### Cola `mining_gateway_q` — NCT → Mining Gateway

```json
{
  "task_id":         "uuid",
  "event_id":        "lp-rolling-stones-2026-10-15",
  "block_candidate": {
    "index":         4,
    "timestamp":     "2026-05-29T20:00:05Z",
    "previous_hash": "00007e4d2f1a...",
    "nonce":         0,
    "transactions":  [ { "tx_id": "...", "type": "resell", ... } ],
    "block_type":    "tx",
    "event_id":      "lp-rolling-stones-2026-10-15"
  },
  "difficulty":        3,
  "nonce_range_start": 0,
  "nonce_range_total": 10000000
}
```

El NCT publica en `exchange:mining` routing `task.global` → la tarea queda en `mining_gateway_q`.

---

## Flujo 3 — Cross-cluster (mTLS HTTPS)

```
Mining Gateway (GKE)  ←──── GET /next-task (HTTPS + cert cliente) ─────  TrP (cluster profe)
                                 long-poll hasta 20 s
Mining Gateway (GKE)  ←──── POST /result   (HTTPS + cert cliente) ─────  TrP (cluster profe)
```

El ingress-nginx de GKE verifica el cert de cliente del TrP con la CA propia.
Si el gateway no tiene tarea disponible, responde `204 No Content` y el TrP vuelve a intentar inmediatamente.

---

## Flujo 4 — Fragmentación y minado (cluster-mining)

### Cola `mining_tasks_q` — TrP → Workers

TrP divide `NONCE_RANGE` (10M) en `FRAGMENTS` rangos iguales y publica uno por worker:

```json
{
  "task_id":        "uuid",
  "fragment_id":    "uuid",
  "event_id":       "lp-rolling-stones-2026-10-15",
  "block_candidate": { ... },
  "difficulty":     3,
  "nonce_start":    0,
  "nonce_end":      2500000
}
```

### Cola `mining_results_pool_q` — Workers → TrP

**Si encontró el nonce:**
```json
{
  "task_id":    "uuid",
  "fragment_id":"uuid",
  "found":      true,
  "nonce":      482910,
  "hash":       "000a3f9c7c..."
}
```

**Keepalives** (cada ~5 s mientras mina): se publican en `exchange:mining_results` routing `keepalive.global`.
Si el TrP no recibe keepalive de un fragmento en `KEEPALIVE_TIMEOUT` segundos, lo redistribuye a otro worker.

---

## Flujo 5 — Confirmación del bloque

```
TrP  →  POST /result  →  Mining Gateway  →  exchange:nct_results (nct.result)  →  NCT
```

El NCT:
1. Verifica `MD5(bloque_sin_nonce + nonce) == hash` y que tenga el prefijo de dificultad.
2. `RPUSH blockchain:{event_id} <bloque_json>` en Redis.
3. Actualiza ownership: `SET ticket:{event_id}:{ticket_id}:owner <to_wallet>`.
4. Si es reventa: `INCR ticket:{event_id}:{ticket_id}:resales`.

---

## Resumen visual completo

```
Browser
  │ HTTP
  ▼
Nginx ──► auth-service ──► PostgreSQL
       ──► event-registry ──► MinIO / Redis
       ──► transaction-api ──► Redis
       │     │
       │     └──[exchange:transactions, tx.new]──► NCT
       │                                             │
       ──► access-control ──► Redis                  │  acumula txs
       ──► status-api ──► (pings)                    │
                                                     │
                                         [exchange:mining, task.global]
                                                     │
                                                     ▼
                                             Mining Gateway
                                          (expuesto vía ingress + mTLS)
                                                     ▲
                                   GET /next-task    │    POST /result
                                   (HTTPS + mTLS)    │    (HTTPS + mTLS)
                                                     │
                                          Transaction Pool (TrP)
                                                     │
                               [exchange:mining_tasks, worker.task]
                                      ┌──────────────┴──────────────┐
                                      ▼                             ▼
                                 Worker GPU                    Worker CPU
                                (C/C++ CUDA)                   (Python)
                                  MD5 PoW                      MD5 PoW
                                      │                             │
                                      └──────────────┬─────────────┘
                                  [exchange:mining_results, result.global]
                                                     │
                                                     ▼
                                          Transaction Pool (TrP)
                                                     │
                                              POST /result
                                                     │
                                                     ▼
                                             Mining Gateway
                                                     │
                               [exchange:nct_results, nct.result]
                                                     │
                                                     ▼
                                                    NCT
                                                     │  verifica hash
                                                     ▼
                                                   Redis
                                      RPUSH blockchain:{event_id}
                                      SET   ticket:{event_id}:{ticket_id}:owner
```
