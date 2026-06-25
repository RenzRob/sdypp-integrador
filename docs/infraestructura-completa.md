# Infraestructura Completa de TicketChain

> **Proyecto:** TicketChain — Plataforma de Ticketing Descentralizada sobre Blockchain
> **Materia:** Sistemas Distribuidos y Programación Paralela 2026 — UNLu
> **Grupo:** 404
> **Fecha:** Junio 2026

---

## Índice

1. [Visión General de la Infraestructura](#1-visión-general-de-la-infraestructura)
2. [Topología de Clusters](#2-topología-de-clusters)
3. [Componentes de Infraestructura Base](#3-componentes-de-infraestructura-base)
4. [Microservicios de la Plataforma](#4-microservicios-de-la-plataforma)
5. [Red y Conectividad](#5-red-y-conectividad)
6. [Seguridad (mTLS y TLS)](#6-seguridad-mtls-y-tls)
7. [Persistencia y Estrategia de Datos](#7-persistencia-y-estrategia-de-datos)
8. [Pipeline de CI/CD](#8-pipeline-de-cicd)
9. [Entorno Local (Docker Compose)](#9-entorno-local-docker-compose)
10. [Entorno Producción (GKE)](#10-entorno-producción-gke)
11. [Flujo de Datos Completo](#11-flujo-de-datos-completo)
12. [Diagrama de Arquitectura](#12-diagrama-de-arquitectura)
13. [Comandos de Despliegue](#13-comandos-de-despliegue)
14. [Procedimiento de Despliegue Desde Cero](#14-procedimiento-de-despliegue-desde-cero)

---

## 1. Visión General de la Infraestructura

TicketChain es un sistema distribuido de emisión, venta y reventa de entradas para eventos que utiliza una blockchain propia para registrar cada operación de forma pública, inmutable y verificable.

La infraestructura se compone de **16 servicios** orquestados que abarcan:

- **5 microservicios Node.js/Express** (REST API para usuarios, eventos, transacciones, control de acceso y monitoreo)
- **3 microservicios Python/FastAPI** (NCT coordinador de blockchain, Mining Gateway, Transaction Pool)
- **2 workers de minería** (CPU en Python, GPU en CUDA C)
- **4 servicios de infraestructura** (PostgreSQL, Redis, RabbitMQ, MinIO)
- **1 frontend React + Vite**
- **1 reverse proxy Nginx**

La arquitectura se despliega sobre **2 clusters GKE separados** que se comunican mediante un modelo PULL con autenticación mTLS.

---

## 2. Topología de Clusters

### 2.1 Cluster 1: `cluster-services` (GKE — Grupo 404)

| Propiedad | Valor |
|---|---|
| Proveedor | Google Kubernetes Engine (GKE) |
| Proyecto GCP | `proyecto-sobel-grupo404` |
| Región | `us-central1` |
| Zonas | `us-central1-a`, `us-central1-b`, `us-central1-f` |
| Nombre del cluster | `app-cluster` |
| Tipo de nodo | `e2-medium` (2 vCPU, 4 GB RAM) |
| Cantidad de nodos | 3 (1 por zona) |
| Disco | 20 GB por nodo |
| Red | `default` |
| Provisionado con | OpenTofu (Terraform) |

**Servicios alojados:**
- Frontend (React + Vite)
- Microservicios Node.js (auth, events, transactions, access-control, status)
- NCT (Nodo Coordinador de Transacciones) — Python/FastAPI
- Mining Gateway — Python/FastAPI
- Infraestructura: PostgreSQL, Redis, RabbitMQ, MinIO
- Reverse proxy: Nginx (ingress-nginx)
- Cert-manager + Let's Encrypt

### 2.2 Cluster 2: `cluster-mining` (g-404 — Profesor)

| Propiedad | Valor |
|---|---|
| Proveedor | GKE (g-404) |
| Tipo de nodo | Incluye nodos con GPU (NVIDIA) |
| Storage class | `longhorn` |

**Servicios alojados:**
- Transaction Pool (TrP) — Python/FastAPI (modo PULL)
- Worker CPU — Python (fallback, HPA 1-10 réplicas)
- Worker GPU — CUDA C + Python wrapper
- RabbitMQ local (aislado del otro cluster)
- NVIDIA Device Plugin (DaemonSet)

### 2.3 Modelo de Comunicación Cross-Cluster

```
┌─────────────────────────────────────────────────────────────────┐
│                    cluster-services (GKE)                       │
│                                                                 │
│  NCT ──→ RabbitMQ (exchange:mining) ──→ Mining Gateway         │
│                                            │                    │
│                                  HTTPS + mTLS │                 │
│                                            │                    │
└────────────────────────────────────────────┼────────────────────┘
                                             │
                                             ▼  (PULL)
┌─────────────────────────────────────────────────────────────────┐
│                    cluster-mining (g-404)                       │
│                                                                 │
│  Transaction Pool ←── GET /next-task                           │
│  Transaction Pool ──→ POST /result                             │
│       │                                                        │
│       ▼                                                        │
│  RabbitMQ local ──→ Workers CPU/GPU                            │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Características del modelo:**
- **PULL:** El Transaction Pool del cluster del profe **nunca recibe conexiones entrantes**. Solo realiza llamadas salientes HTTPS hacia el Mining Gateway.
- **Un solo endpoint público:** El Mining Gateway en GKE expone `GET /next-task` y `POST /result`.
- **mTLS obligatorio:** El ingress-nginx del gateway exige que el TrP presente un certificado de cliente firmado por la CA propia del grupo.
- **RabbitMQ nunca se expone:** Ni el del cluster-services ni el del cluster-mining tienen puertos públicos.

### 2.4 Justificación de la Arquitectura de 2 Clusters

1. **Aislamiento de responsabilidades:** El cluster del profe contiene la lógica de minería pesada (GPU) que consume muchos recursos. El cluster de servicios mantiene la API pública liviana.
2. **Seguridad:** El cluster de minería no expone ningún endpoint. Si un atacante comprometiera la red del profe, no podría atacar los servicios del grupo porque no hay puerto de entrada.
3. **Recursos especializados:** El worker GPU necesita nodos con GPUs NVIDIA. Estos nodos están en el cluster del profe y no contaminan el cluster de servicios con costos adicionales.
4. **Escalabilidad independiente:** Se puede escalar workers (CPU/GPU) en el cluster de minería sin afectar los servicios API. El HPA del worker-cpu escala de 1 a 10 réplicas al 70% de CPU.

---

## 3. Componentes de Infraestructura Base

### 3.1 PostgreSQL 16 Alpine

**Propósito:** Base de datos relacional para almacenar usuarios, credenciales y sesiones.

```yaml
# docker-compose.yml
postgres:
  image: postgres:16-alpine
  environment:
    POSTGRES_USER: ticketchain
    POSTGRES_PASSWORD: ticketchain
    POSTGRES_DB: ticketchain
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ticketchain"]
    interval: 10s
    timeout: 5s
    retries: 5
```

**K8s:** PVC de 5Gi con `standard-rwo`, mismo `POSTGRES_USER`/`POSTGRES_PASSWORD` inyectados via Secret.

**Acceden:** `auth-service` (único servicio con conexión directa a PostgreSQL).

### 3.2 Redis 7 Alpine

**Propósito:** Base de datos en memoria que funciona como ledger de la blockchain, almacén de tickets en tiempo real, cola de operaciones temporales y caché distribuida.

```yaml
# docker-compose.yml
redis:
  image: redis:7-alpine
  command: redis-server --appendonly yes --save 3600 1 --save 300 100 --save 60 10000
  volumes:
    - redis_data:/data
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 10s
    timeout: 5s
    retries: 5
```

**K8s:** PVC de 1Gi con `standard-rwo`.

**Estrategia de persistencia (AOF + RDB combinados):**

| Estrategia | Configuración | Comportamiento |
|---|---|---|
| **AOF (Append Only File)** | `--appendonly yes` | Cada comando que modifica datos se escribe en un archivo de log. Redis hace fsync cada 1 segundo. En el peor caso (crash), se pierde máximo 1 segundo de datos. |
| **RDB Snapshot (1 hora)** | `--save 3600 1` | Redis genera un snapshot completo de la memoria en un archivo `.rdb` comprimido cada 3600 segundos si al menos 1 clave cambió. |
| **RDB Snapshot (5 min)** | `--save 300 100` | Snapshot cada 300 segundos si al menos 100 claves cambiaron. |
| **RDB Snapshot (1 min)** | `--save 60 10000` | Snapshot cada 60 segundos si al menos 10.000 claves cambiaron (picos de alta escritura). |

**¿Por qué combinar AOF + RDB?**

- **AOF solo:** Si el archivo AOF crece a gigabytes (toda la historia de comandos), Redis tardaría minutos en arrancar porque reproduce cada comando línea por línea.
- **RDB solo:** Si el servidor falla, se pierden todos los datos desde el último snapshot (hasta 1 hora de datos).
- **Combinación:** Redis arranca cargando el RDB más reciente (instantáneo), y luego reproduce solo los comandos AOF posteriores a ese snapshot. Lo mejor de ambos mundos: startup rápido + pérdida mínima de datos.

**Estructura de datos en Redis:**

```
# Blockchain por evento (lista de bloques)
blockchain:{event_id} → LIST of JSON blocks

# Ownership de tickets (hashes)
ticket:{event_id}:{ticket_id}:owner → STRING (wallet_address)
ticket:{event_id}:{ticket_id}:resale_count → INTEGER
ticket:{event_id}:{ticket_id}:qr_secret → STRING (random UUID)

# Pool de tickets disponibles para un evento (lista)
event:{id}:tickets:pool → LIST of ticket_ids

# Resale listings (sorted set by price)
event:{id}:resale → ZSET (member = ticket_id, score = price)

# Resale listing details (hash)
resale:{event_id}:{ticket_id} → HASH (seller, price, timestamp)
```

**Acceden:** `event-registry`, `transaction-api`, `access-control`, `status-api`, `nct` (todos con `REDIS_URL`).

### 3.3 RabbitMQ 3.12 Management Alpine

**Propósito:** Message broker para comunicación asíncrona entre servicios. Maneja 3 exchanges diferentes en `cluster-services` y 2 exchanges locales en `cluster-mining`.

```yaml
# docker-compose.yml
rabbitmq:
  image: rabbitmq:3.12-management-alpine
  volumes:
    - rabbitmq_data:/var/lib/rabbitmq
  ports:
    - "15672:15672"  # Management UI (solo local)
```

**K8s:** PVC de 1Gi (standard-rwo en cluster-services, longhorn en cluster-mining).

**Topología de Exchanges y Queues:**

```
cluster-services:
┌─────────────────────────────────────────────────────────┐
│  exchange:transactions (direct)                         │
│    routing key: tx.new                                   │
│    └── queue:transactions_queue ──→ NCT consume          │
│                                                          │
│  exchange:mining (direct)                                │
│    routing key: task.global                               │
│    └── queue:mining_queue ──→ Mining Gateway consume      │
│                                                          │
│  exchange:nct_results (direct)                           │
│    routing key: nct.result                                │
│    └── queue:nct_results_queue ──→ NCT consume           │
└─────────────────────────────────────────────────────────┘

cluster-mining (local):
┌─────────────────────────────────────────────────────────┐
│  exchange:mining_tasks (direct)                          │
│    routing key: worker.task                               │
│    └── queue:mining_tasks_q ──→ Workers (CPU/GPU)        │
│                                                          │
│  exchange:mining_results (direct)                        │
│    routing key: result.global (results from workers)      │
│    routing key: keepalive.global (keepalives from CPUs)  │
│    └── queue:results_queue ──→ Transaction Pool consume  │
└─────────────────────────────────────────────────────────┘
```

**Flujo de mensajes:**

1. `transaction-api` publica en `transactions` (routing `tx.new`)
2. NCT consume de `transactions_queue` y forma bloques
3. NCT publica tarea de minado en `mining` (routing `task.global`)
4. Mining Gateway consume de `mining_queue` y la expone vía `GET /next-task`
5. TrP recibe la tarea y la fragmenta en rangos de nonce
6. TrP publica fragmentos en `mining_tasks` (routing `worker.task`)
7. Workers consumen fragmentos, minan y publican resultados en `mining_results`
8. TrP consume resultados, ensambla el bloque y lo publica vía `POST /result`
9. Mining Gateway recibe el resultado y lo publica en `nct_results`
10. NCT consume de `nct_results_queue`, verifica y persiste el bloque

### 3.4 MinIO

**Propósito:** Almacenamiento de objetos S3-compatible para imágenes de eventos (flyers, estadios, etc.).

```yaml
minio:
  image: minio/minio:latest
  command: server /data --console-address ":9001"
  env_file: .env
  volumes:
    - minio_data:/data
  ports:
    - "9001:9001"  # Console (solo local)
  healthcheck:
    test: ["CMD", "curl", "-f", "http://localhost:9000/minio/health/live"]
```

**K8s:** PVC de 3Gi.

**Bucket:** `ticketchain` (creado automáticamente por `event-registry` con política de lectura pública).

**Acceso:** Las imágenes se sirven a través de Nginx en `/images/` que hace proxy_pass a MinIO (ruta `/ticketchain/...`). Los usuarios pueden ver imágenes sin autenticación.

---

## 4. Microservicios de la Plataforma

### 4.1 auth-service (Node.js — Puerto 3001)

| Aspecto | Detalle |
|---|---|
| **Stack** | Node.js 20, Express, pg, bcryptjs, jsonwebtoken, express-validator, uuid |
| **Base de datos** | PostgreSQL (pool de conexiones) |
| **Autenticación** | JWT con expiración de 24 horas |
| **Wallet address** | Generada como `0x` + primeros 8 hex de SHA-256(user_id) |
| **Dockerfile** | `node:20-alpine` |
| **Imagen K8s** | `ghcr.io/renzrob/auth-service:latest` |
| **Health check** | `GET /ping` |

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/ping` | No | Health check |
| `POST` | `/auth/register` | No | Registro con email + password. Devuelve JWT, user_id, wallet_address |
| `POST` | `/auth/login` | No | Login. Devuelve JWT + datos de usuario |
| `GET` | `/auth/me` | requireAuth | Perfil del usuario autenticado |

**Particularidades:**
- Al iniciar, auto-crea el schema de la tabla `users` si no existe
- Auto-seedea un admin desde variables de entorno (`ADMIN_EMAIL`, `ADMIN_PASSWORD`)
- Passwords hasheados con bcrypt (12 rondas de sal)
- JWT contiene: `sub` (user_id), `email`, `role` (user/admin), `wallet_address`, `iat`, `exp`

### 4.2 event-registry (Node.js — Puerto 3002)

| Aspecto | Detalle |
|---|---|
| **Stack** | Node.js 20, Express, ioredis, minio SDK, multer, jsonwebtoken, uuid |
| **Bases de datos** | Redis (eventos, blockchain genesis), MinIO (imágenes) |
| **Dockerfile** | `node:20-alpine` |
| **Imagen K8s** | `ghcr.io/renzrob/event-registry:latest` |

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/ping` | No | Health check |
| `POST` | `/events/upload-image` | admin | Sube imagen a MinIO (valida tipo por magic bytes) |
| `GET` | `/events` | No | Lista todos los eventos |
| `POST` | `/events` | admin | Crea evento + reglas de negocio + bloque génesis + pool de tickets |
| `GET` | `/events/:id` | No | Detalle del evento (con tickets disponibles y longitud de blockchain) |
| `PATCH` | `/events/:id` | admin (creator) | Actualiza fecha/estado del evento |
| `GET` | `/events/:id/blockchain` | No | Blockchain completa del evento |
| `GET` | `/events/:id/tickets` | No | Estado de todos los tickets del evento |

**Estructura de un evento en Redis:**

```json
{
  "id": "uuid",
  "creator_id": "uuid",
  "nombre": "Rolling Stones en Luna Park",
  "descripcion": "...",
  "fecha": "2026-10-15T20:00:00Z",
  "ubicacion": "Luna Park, CABA",
  "imagen_url": "/images/eventos/uuid.jpg",
  "total_tickets": 5000,
  "precio_base": 15000,
  "reglas": {
    "precio_max": 150,
    "max_reventas": 3,
    "nominada": false,
    "ventana_venta": 24
  },
  "estado": "activo",
  "genesis_block_hash": "a1b2c3d4...",
  "created_at": "..."
}
```

**Reglas de negocio del bloque génesis (inmutables):**

| Parámetro | Descripción | Ejemplo |
|---|---|---|
| `precio_max` | Porcentaje máximo del precio base permitido en reventa | `150` = 150% del precio original |
| `max_reventas` | Cantidad máxima de reventas por ticket | `3` = puede revenderse hasta 3 veces |
| `nominada` | Si es `true`, la entrada es intransferible | `false` |
| `ventana_venta` | Horas antes del evento hasta cuando se puede revender | `24` = hasta 24h antes del evento |

### 4.3 transaction-api (Node.js — Puerto 3003)

| Aspecto | Detalle |
|---|---|
| **Stack** | Node.js 20, Express, ioredis, amqplib, mercadopago SDK, jsonwebtoken, uuid |
| **Bases de datos** | Redis (tickets, resale listings), RabbitMQ (publica `tx.new`) |
| **Integración** | Mercado Pago (pagos), RabbitMQ (mensajería asíncrona) |
| **Dockerfile** | `node:20-alpine` |
| **Imagen K8s** | `ghcr.io/renzrob/transaction-api:latest` |

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/ping` | No | Health check |
| `POST` | `/transactions/buy` | requireAuth | Compra oficial: asigna ticket del pool, crea preferencia MP |
| `GET` | `/transactions/mp/success` | No | Redirect post-pago exitoso de MP |
| `POST` | `/transactions/mp/webhook` | No | Webhook de MP (verificado con HMAC SHA-256) |
| `POST` | `/transactions/list` | requireAuth | Lista ticket para reventa (valida reglas de negocio) |
| `DELETE` | `/transactions/list/:event_id/:ticket_id` | requireAuth | Cancela listing de reventa |
| `GET` | `/transactions/listings/:event_id` | No | Lista de reventas activas (ordenadas por precio) |
| `POST` | `/transactions/buy-listed` | requireAuth | Compra en reventa |
| `POST` | `/transactions/resell` | requireAuth | Reventa directa P2P (sin marketplace) |
| `GET` | `/transactions/my-tickets` | requireAuth | Tickets del usuario autenticado |
| `GET` | `/transactions/qr-token/:event_id/:ticket_id` | requireAuth | Genera token JWT para QR (válido 60 segundos) |
| `GET` | `/transactions/status/:tx_id` | requireAuth | Estado de una transacción |

**Flujo de compra con Mercado Pago:**

```
1. Usuario → POST /transactions/buy
2. transaction-api → Redis: LPOP ticket from pool
3. transaction-api → Redis: SET ticket:owner = pending_payment (TTL 900s)
4. transaction-api → Mercado Pago: POST /v1/payments (crea preferencia)
5. MP → Usuario: init_point (URL de pago)
6. Usuario → MP: Paga
7. MP → transaction-api: POST /transactions/mp/webhook (HMAC-verificado)
8. transaction-api → Redis: SET ticket:owner = wallet_address (permantente)
9. transaction-api → RabbitMQ: publish tx.new (para minar en blockchain)
```

### 4.4 access-control (Node.js — Puerto 3004)

| Aspecto | Detalle |
|---|---|
| **Stack** | Node.js 20, Express, ioredis, jsonwebtoken, uuid |
| **Base de datos** | Redis (consulta ownership de tickets) |
| **Dockerfile** | `node:20-alpine` |
| **Imagen K8s** | `ghcr.io/renzrob/access-control:latest` |

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/ping` | No | Health check |
| `GET` | `/access/:event_id/:ticket_id` | No | Consulta estado del ticket (owner, reventas, checked-in) |
| `POST` | `/access/scan` | No | Escanea QR: valida JWT, verifica ownership en Redis, registra ingreso |

**Validación en puerta:**
1. El usuario presenta un QR que contiene un JWT firmado con un secreto único del ticket
2. El JWT expira a los 60 segundos (anti-replay)
3. `access-control` verifica:
   - Que la firma JWT sea válida
   - Que el evento esté activo
   - Que el owner en Redis coincida con el sub del JWT
   - Que el ticket no haya sido ya escaneado (anti-reingreso)
4. Si todo OK, marca `checked_in: true` en Redis y permite el ingreso

### 4.5 status-api (Node.js — Puerto 3005)

| Aspecto | Detalle |
|---|---|
| **Stack** | Node.js 20, Express, ioredis, amqplib |
| **Dependencias** | Hace pings HTTP a todos los servicios + Redis + RabbitMQ |
| **Dockerfile** | `node:20-alpine` |
| **Imagen K8s** | `ghcr.io/renzrob/status-api:latest` |

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/ping` | No | Health check |
| `GET` | `/status` | No | Dashboard de salud: todos los servicios con latencia |

**Servicios monitoreados:**
- auth-service (HTTP GET /ping)
- event-registry (HTTP GET /ping)
- transaction-api (HTTP GET /ping)
- access-control (HTTP GET /ping)
- nct-miner (HTTP GET /ping)
- Redis (comando PING via ioredis)
- RabbitMQ (conexión via amqplib)

Cada chequeo tiene timeout de 3 segundos. Se reporta latencia individual y estado global (OK/DEGRADED/ERROR).

### 4.6 NCT — Nodo Coordinador de Transacciones (Python — Puerto 8000)

| Aspecto | Detalle |
|---|---|
| **Stack** | Python 3.11, FastAPI, uvicorn, redis-py, pika, threading |
| **Bases de datos** | Redis (blockchain ledger), RabbitMQ (consume txs, publica minado, consume resultados) |
| **Dockerfile** | `python:3.11-slim` |
| **Imagen K8s** | `ghcr.io/renzrob/nct:latest` |

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/ping` | No | Health check (incluye bloques minados) |
| `GET` | `/stats` | No | Estadísticas: bloques minados, transacciones procesadas |

**Arquitectura interna:**

El NCT ejecuta un hilo demonio (`NCT.start()`) que:

1. **Consume transacciones** de RabbitMQ (`exchange:transactions`, routing `tx.new`)
2. **Acumula** transacciones en un buffer en memoria
3. **Forma un bloque candidato** cuando:
   - Se acumulan `MAX_TX_PER_BLOCK` (5) transacciones, o
   - Vence el `BLOCK_TIMEOUT` (10 segundos)
4. **Determina el event_id dominante** por mayoría de votos entre las transacciones acumuladas
5. **Serializa el bloque** con `json.dumps(sort_keys=True)`, excluyendo `nonce` y `block_hash`
6. **Publica la tarea de minado** en `exchange:mining` (routing `task.global`)
7. **Espera el resultado** en `exchange:nct_results` (routing `nct.result`)
8. **Verifica el resultado:** re-computa el hash con el nonce recibido y chequea que cumpla la dificultad (prefijo de N ceros)
9. **Persiste el bloque** en Redis como `blockchain:{event_id}` (RPUSH)
10. **Actualiza ownership** de los tickets involucrados en Redis (`ticket:{event_id}:{ticket_id}:owner`)

**Estructura de un bloque en la blockchain de Redis:**

```json
{
  "index": 15,
  "timestamp": "2026-06-01T14:32:00Z",
  "event_id": "lp-rolling-stones-2026-10-15",
  "transactions": [
    {
      "from": "productora_luna_park",
      "to": "usuario_0x4f3a",
      "evento_id": "lp-rolling-stones-2026-10-15",
      "entrada_id": "SECTOR-A-FILA-12-ASIENTO-5",
      "precio": 15000,
      "tipo": "buy",
      "timestamp": "2026-06-01T14:31:55Z"
    }
  ],
  "previous_hash": "0000a1b2c3d4e5f6...",
  "nonce": 1234567,
  "block_hash": "0000f6e5d4c3b2a1...",
  "difficulty": 4
}
```

### 4.7 Mining Gateway (Python — Puerto 8000)

| Aspecto | Detalle |
|---|---|
| **Stack** | Python 3.11, FastAPI, uvicorn, pika, requests |
| **Bases de datos** | RabbitMQ (consume mining tasks, publica resultados) |
| **Seguridad** | mTLS (verificado por ingress-nginx) |
| **Dockerfile** | `python:3.11-slim` |
| **Imagen K8s** | `ghcr.io/renzrob/mining-gateway:latest` |

**Endpoints:**

| Método | Ruta | Auth | Descripción |
|---|---|---|---|
| `GET` | `/ping` | No | Health check |
| `GET` | `/next-task` | mTLS | Long-poll: devuelve una tarea de minado o 204 si no hay |
| `POST` | `/result` | mTLS | Recibe resultado minado del TrP y lo publica en RabbitMQ |

**Modelo de long-poll:**
- El TrP llama a `GET /next-task` con timeout de 30 segundos
- El gateway consume de la queue `mining_queue`
- Si no hay tarea disponible, espera hasta `POLL_WAIT` (20s) antes de responder 204
- Esto evita polling constante y reduce latencia

### 4.8 Transaction Pool — TrP (Python — Sin puerto HTTP)

| Aspecto | Detalle |
|---|---|
| **Stack** | Python 3.11, pika, requests, threading |
| **Bases de datos** | RabbitMQ local (publica tareas, consume resultados) |
| **Comunicación** | HTTPS saliente al Mining Gateway (mTLS) |
| **Dockerfile** | `python:3.11-slim` |
| **Imagen K8s** | `ghcr.io/renzrob/transaction-pool:latest` |

**Flujo interno:**

1. **Thread principal:** Loop infinito que hace PULL al gateway:
   - `GET /next-task` → recibe tarea de minado
   - Publica fragmentos en RabbitMQ local (`mining_tasks`, routing `worker.task`)
   - Espera resultados y keepalives

2. **Fragmentación del nonce:**
   - Rango total: `NONCE_RANGE` = 10.000.000 (configurable)
   - Fragmentos: `FRAGMENTS` = 4 (configurable)
   - Cada fragmento = rango de nonces [start, end)
   - Publica cada fragmento como una tarea separada para los workers

3. **Thread consumidor:** Escucha resultados en `mining_results` exchange:
   - Routing `result.global`: resultado encontrado por un worker
   - Routing `keepalive.global`: heartbeat del worker CPU (cada 5s)

4. **Monitor de keepalives:** Si un worker no envía keepalive en `KEEPALIVE_TIMEOUT` (30s), el TrP:
   - Marca el fragmento como huérfano
   - Lo redistribuye a otro worker disponible

5. **Ensamblado y posteo:**
   - Cuando un worker encuentra el nonce, el TrP reensambla el bloque completo
   - POSTea a `POST /result` en el Mining Gateway con hasta 5 reintentos

### 4.9 Worker CPU (Python)

| Aspecto | Detalle |
|---|---|
| **Stack** | Python 3.11, pika, hashlib |
| **Algoritmo** | MD5 (`hashlib.md5`) |
| **Keepalive** | Sí, cada 5 segundos |
| **HPA** | 1-10 réplicas, target 70% CPU |
| **Dockerfile** | `python:3.11-slim` |
| **Imagen K8s** | `ghcr.io/renzrob/worker-cpu:latest` |

**Lógica de minado CPU:**
```python
def mine_range(block_data, prefix_len, start_nonce, end_nonce, keepalive_callback):
    prefix = "0" * prefix_len
    for nonce in range(start_nonce, end_nonce):
        if nonce % 1000 == 0:
            keepalive_callback(nonce)
        hash_result = md5(block_data + str(nonce))
        if hash_result.startswith(prefix):
            return nonce, hash_result
    return None
```

### 4.10 Worker GPU (CUDA C + Python wrapper)

| Aspecto | Detalle |
|---|---|
| **Stack** | CUDA 12.3, nvcc, Python 3.11, pika |
| **Algoritmo** | MD5 implementado en CUDA (RFC 1321) |
| **Base image** | `nvidia/cuda:12.3.1-devel-ubuntu22.04` |
| **Binary** | `./range_miner <data> <prefix> <start> <end>` |
| **Imagen K8s** | `ghcr.io/renzrob/worker-gpu:latest` |
| **Recursos K8s** | 1 GPU NVIDIA, 1 CPU, 1Gi RAM |

**Implementación CUDA:**
- `md5.cuh`: Implementación completa de MD5 para GPU (funciones device)
- `hit7_range_miner.cu`: Kernel que busca nonces en paralelo
  - Cada thread prueba un nonce distinto
  - Usa `atomicCAS` (Compare And Swap) atómico para marcar solución encontrada
  - `NONCES_PER_LAUNCH = 262,144` nonces por lanzamiento de kernel
  - Exit code 0 = solución encontrada, 1 = no encontrada en el rango

**Diferencia clave con CPU:**
- El worker GPU **NO envía keepalives** (el minado es demasiado rápido, enviar keepalives agregaría overhead innecesario)
- El worker GPU delega el minado a un binario CUDA compilado vía `subprocess`
- El worker GPU no tiene HPA (solo 1 réplica con `strategy: Recreate` porque hay 1 GPU disponible)

### 4.11 Frontend (React + Vite)

| Aspecto | Detalle |
|---|---|
| **Stack** | React 18, Vite 5, react-router-dom 6, qrcode |
| **Proxy dev** | Vite proxy `/api` → `http://nginx:80` |
| **Puerto dev** | 5173 |
| **Dockerfile** | Multi-stage (base, dev, builder, preview) |
| **Imagen K8s** | `ghcr.io/renzrob/frontend:latest` |

**Rutas del frontend:**

| Ruta | Componente | Auth | Descripción |
|---|---|---|---|
| `/login` | Login | No | Formulario de inicio de sesión |
| `/register` | Register | No | Registro de usuario |
| `/events` | Events | No | Listado de eventos |
| `/events/:id` | EventDetail | No | Detalle del evento (compra + reventa + blockchain) |
| `/my-tickets` | MyTickets | requireAuth | Tickets del usuario + QR |
| `/scan` | Scan | No | Validador QR (control de acceso) |
| `/admin/create` | CreateEvent | admin | Creación de eventos |
| `/admin/edit/:id` | EditEvent | admin | Edición de eventos |
| `/admin/status` | PlatformStatus | admin | Dashboard de salud del sistema |

**Componentes compartidos:**
- `Navbar`: Navegación sticky con roles (guest/user/admin)
- `EventCard`: Card de evento con imagen, fecha, precio y disponibilidad
- `TicketCard`: Card de ticket con acciones (comprar, revender)
- `ProtectedRoute` / `AdminRoute`: Guards de autenticación
- `BlockchainViewer`: Explorador visual de bloques minados

---

## 5. Red y Conectividad

### 5.1 Reverse Proxy — Nginx (Local)

En el entorno local, Nginx actúa como API Gateway en el puerto 80:

| Ruta | Destino | Reescritura |
|---|---|---|
| `/api/auth/*` | `auth-service:3001` | `/auth/*` |
| `/api/events/*` | `event-registry:3002` | `/events/*` |
| `/api/transactions/*` | `transaction-api:3003` | `/transactions/*` |
| `/api/access/*` | `access-control:3004` | `/access/*` |
| `/api/status/*` | `status-api:3005` | `/*` |
| `/images/*` | `minio:9000` | `/ticketchain/*` |
| `/` | Frontend estático | SPA fallback |

### 5.2 Ingress Controllers (K8s)

En producción, ingress-nginx reemplaza al Nginx interno. Hay 4 Ingress separados:

| Ingress | Host | Path | Backend | TLS |
|---|---|---|---|---|
| `ticketchain-frontend` | `ticketchain404.duckdns.org` | `/` | `frontend-service:5173` | Let's Encrypt |
| `ticketchain-api` | `ticketchain404.duckdns.org` | `/api/(auth\|events\|transactions\|access)/*` | Respectivos services | Let's Encrypt |
| `ticketchain-api-status` | `ticketchain404.duckdns.org` | `/api/status/*` | `status-api:3005` | Let's Encrypt |
| `ticketchain-images` | `ticketchain404.duckdns.org` | `/images/*` | `minio:9000` | Let's Encrypt |
| `mining-gateway-ingress` | `gateway.34.61.108.95.nip.io` | `/` | `mining-gateway:8000` | Self-signed + mTLS |

### 5.3 Puertos Expuestos

| Servicio | Puerto Interno | Puerto Externo (local) |
|---|---|---|
| nginx | 80 | 80 |
| auth-service | 3001 | 3001 |
| event-registry | 3002 | 3002 |
| transaction-api | 3003 | 3003 |
| access-control | 3004 | 3004 |
| status-api | 3005 | 3005 |
| nct | 8000 | 8000 |
| rabbitmq management | 15672 | 15672 |
| minio console | 9001 | 9001 |

### 5.4 Servicios ClusterIP (K8s)

Todos los servicios en K8s son tipo `ClusterIP` (accesibles solo dentro del cluster). El único punto de entrada público es el ingress-nginx.

---

## 6. Seguridad (mTLS y TLS)

### 6.1 Doble Capa de HTTPS

```
Capa 1 — Frontend (Let's Encrypt)
───────────────────────────────────
Browser → HTTPS (público, certificado confiable)
         → ingress-nginx (ticketchain404.duckdns.org)
         → cert-manager renueva automáticamente vía HTTP-01 challenge

Capa 2 — Cross-cluster (CA propia, mTLS mutuo)
───────────────────────────────────
TrP (cluster-mining) → HTTPS + mTLS → ingress-nginx (gateway.34.61.108.95.nip.io)
                        ↓
                   Mining Gateway (cluster-services)
```

### 6.2 Configuración mTLS

El ingress-nginx del Mining Gateway está configurado para:

1. **Verificar el cliente** (`auth-tls-verify-client: "on"`)
2. **Validar contra la CA propia** (`auth-tls-secret: "g-404/cross-cluster-ca"`)
3. **Profundidad de verificación 1** (`auth-tls-verify-depth: "1"`)

**Flujo de handshake mTLS:**

```
TrP (cliente)                   Gateway (servidor)
     │                                  │
     │────── ClientHello ──────────────→│
     │←───── ServerHello + Cert ────────│  ← cert del gateway
     │←───── CertificateRequest ────────│
     │────── Client Certificate ───────→│  ← cert del TrP (firmado por CA)
     │────── Client CertificateVerify ─→│
     │                                  │  ingress-nginx verifica:
     │                                  │  1. cert del TrP tiene firma válida de CA
     │                                  │  2. cert del TrP no está expirado
     │                                  │  3. cert del TrP está en la cadena de confianza
     │←───── HTTP 200 OK ───────────────│
```

### 6.3 Certificados Generados

Script: `iac/k8s/certs/gen-certs.sh` (genera CA + certificados con 3650 días de validez)

| Secret | Cluster | Contenido |
|---|---|---|
| `gateway-tls` | cluster-services | `gateway.crt` + `gateway.key` (cert de servidor) |
| `cross-cluster-ca` | cluster-services | `ca.crt` (para verificar al TrP) |
| `trp-tls` | cluster-mining | `trp.crt` + `trp.key` (cert de cliente) |
| `cross-cluster-ca` | cluster-mining | `ca.crt` (para verificar al gateway) |

Los certificados privados (directorio `out/`) están en `.gitignore` y **nunca se commitean**.

### 6.4 ClusterIssuer (Let's Encrypt)

```yaml
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: renzomartinrobles99@gmail.com
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            ingressClassName: nginx
```

---

## 7. Persistencia y Estrategia de Datos

### 7.1 Mapeo de Datos por Tecnología

| Tecnología | Qué almacena | Estrategia de persistencia | Tamaño |
|---|---|---|---|
| **PostgreSQL** | Usuarios, credenciales, sesiones | WAL + backups periódicos | 5Gi (K8s) |
| **Redis** | Blockchain, tickets, listings, colas temporales | AOF + RDB (3 reglas) | 1Gi (K8s) |
| **RabbitMQ** | Mensajes en tránsito (transacciones, tareas de minado) | Persistencia en disco | 1Gi (K8s) |
| **MinIO** | Imágenes de eventos (flyers, mapas de estadio) | Disco (PV) | 3Gi (K8s) |

### 7.2 Ciclo de Vida de los Datos de un Evento

```
Fase 1: Creación del evento
  event-registry → Redis: HSET event:{id} (datos + reglas)
                 → Redis: RPUSH event:{id}:tickets:pool (N tickets)
                 → MinIO: PUT /ticketchain/{imagen}

Fase 2: Venta primaria
  transaction-api → Redis: LPOP event:{id}:tickets:pool
                  → Redis: SET ticket:{id}:owner = wallet
                  → RabbitMQ: publish tx.new "buy"

Fase 3: NCT mina el bloque
  NCT → Redis: RPUSH blockchain:{event_id} (bloque)
      → Redis: SET ticket:{id}:owner (actualiza)

Fase 4: Reventa (opcional)
  transaction-api → Redis: ZADD event:{id}:resale
                  → Redis: SET ticket:{id}:owner (nuevo owner)
                  → Redis: INCR ticket:{id}:resale_count
                  → RabbitMQ: publish tx.new "resell"
                  → NCT mina el bloque

Fase 5: Control de acceso
  access-control → Redis: GET ticket:{id}:owner (verifica)
                 → Redis: SET ticket:{id}:checked_in (marca ingreso)

Fase 6: Cierre del evento
  La blockchain del evento se archiva en cold storage
  (fuera del alcance actual del proyecto)
```

### 7.3 Estrategia de Persistencia de Redis en Detalle

Nuestra configuración combina **AOF + RDB** para maximizar durabilidad sin sacrificar velocidad de startup:

**AOF (Append Only File) — `--appendonly yes`**
- Cada comando de escritura (SET, RPUSH, LPOP, etc.) se agrega al archivo `appendonly.aof`
- Redis hace `fsync` al disco cada 1 segundo
- Pérdida máxima en caso de crash: 1 segundo de datos
- Desventaja: el archivo crece indefinidamente (todo el historial de comandos)

**RDB (Redis Database) — `--save 3600 1 --save 300 100 --save 60 10000`**
- Redis genera un snapshot binario completo de la memoria en `dump.rdb`
- Tres reglas complementarias para cubrir distintos patrones de escritura:
  - Baja actividad: snapshot cada 1 hora (suficiente para cambios mínimos)
  - Actividad media: snapshot cada 5 minutos (100+ cambios)
  - Alta actividad: snapshot cada 1 minuto (10.000+ cambios en picos)
- Ventaja: el archivo es compacto (binario comprimido) y se carga al instante
- El RDB se carga primero al iniciar Redis, luego se reproducen solo los comandos AOF pendientes

**¿Qué pasaría con solo AOF?**
Si Redis procesa 1.000.000 de comandos por día, el archivo AOF crece a cientos de megabytes o gigabytes. Al reiniciar Redis, debe reproducir cada comando línea por línea, lo que puede tomar minutos.

**¿Qué pasaría con solo RDB?**
Si el servidor se apaga inesperadamente 59 minutos después del último snapshot, se pierden 59 minutos de datos (todas las transacciones, asignaciones de tickets, etc.).

**Con AOF + RDB combinados:**
- Startup: carga RDB (instantáneo, segundos)
- Recuperación: reproduce solo comandos AOF posteriores al RDB (segundos)
- Pérdida máxima: nunca más de 1 segundo de datos (gracias al fsync del AOF)

---

## 8. Pipeline de CI/CD

### 8.1 GitHub Actions Workflow

**Archivo:** `.github/workflows/ci-cd.yml`  
**Trigger:** Push o Pull Request a `main`  
**Permisos:** `contents: read`, `packages: write`

```
Jobs (5, secuenciales):
┌──────────────┐
│   gitleaks   │  ← Escanea secrets en el código
└──────┬───────┘
       │ (push only)
┌──────▼──────────────────────────┐
│        build-push               │  ← Matrix build: 10 imágenes Docker
│  (auth, events, tx, access,     │     Build + push a ghcr.io
│   status, nct, gateway, trp,    │     Usa cache de GitHub Actions
│   worker-cpu, frontend)         │
└──────┬──────────────────────────┘
       │
┌──────▼──────────────────────────┐
│      build-push-gpu             │  ← Solo si cambió worker-gpu/
│  (worker-gpu)                   │     (git diff HEAD~1)
└──────┬──────────────────────────┘
       │
┌──────▼──────────────────────────┐
│     deploy-services             │
│  kubectl apply + rollout restart│  ← cluster-services (GKE)
│  (nct, auth, events, tx,        │
│   access, status, frontend,     │
│   mining-gateway)               │
└──────┬──────────────────────────┘
       │
┌──────▼──────────────────────────┐
│     deploy-mining               │
│  kubectl apply + rollout restart│  ← cluster-mining (g-404)
│  (transaction-pool, worker-cpu) │
└─────────────────────────────────┘
```

### 8.2 Secrets de CI/CD

| Secret | Propósito |
|---|---|
| `GHCR_TOKEN` | Token de GitHub para pushear imágenes a ghcr.io |
| `KUBE_CONFIG_SERVICES` | Kubeconfig del cluster-services (GKE) |
| `KUBE_CONFIG_MINING` | Kubeconfig del cluster-mining (g-404) |

### 8.3 Imágenes Docker

Registry: `ghcr.io/renzrob/`

| Imagen | Dockerfile | Base |
|---|---|---|
| `auth-service:latest` | `backend/auth-service/Dockerfile` | node:20-alpine |
| `event-registry:latest` | `backend/event-registry/Dockerfile` | node:20-alpine |
| `transaction-api:latest` | `backend/transaction-api/Dockerfile` | node:20-alpine |
| `access-control:latest` | `backend/access-control/Dockerfile` | node:20-alpine |
| `status-api:latest` | `backend/status-api/Dockerfile` | node:20-alpine |
| `nct:latest` | `backend/nct/Dockerfile` | python:3.11-slim |
| `mining-gateway:latest` | `backend/mining-gateway/Dockerfile` | python:3.11-slim |
| `transaction-pool:latest` | `backend/transaction-pool/Dockerfile` | python:3.11-slim |
| `worker-cpu:latest` | `backend/worker-cpu/Dockerfile` | python:3.11-slim |
| `worker-gpu:latest` | `backend/worker-gpu/Dockerfile` | nvidia/cuda:12.3.1-devel-ubuntu22.04 |
| `frontend:latest` | `frontend/Dockerfile` | node:20-alpine (multi-stage) |

---

## 9. Entorno Local (Docker Compose)

### 9.1 Estructura

```
iac/local/
├── docker-compose.yml   → 16 servicios orquestados
├── .env                 → Variables de entorno (desarrollo)
├── run_local.sh         → Script de gestión
└── nginx/
    ├── Dockerfile       → Construye nginx con frontend estático
    └── nginx.conf       → Reverse proxy configuration
```

### 9.2 Dependencias entre Servicios

```
postgres ──→ auth-service
redis ──→ event-registry, transaction-api, access-control, status-api, nct
rabbitmq ──→ transaction-api, nct, mining-gateway, transaction-pool, worker-cpu, status-api
minio ──→ event-registry
mining-gateway ──→ transaction-pool (HTTP)
```

### 9.3 Script de Gestión `run_local.sh`

| Flag | Comportamiento |
|---|---|
| (sin flag) | `docker compose up --build -d` (build + start) |
| `--no-build` | `docker compose up -d` (sin rebuild) |
| `--logs` | `docker compose logs -f` (logs en tiempo real) |
| `--down` | `docker compose down` (stop) |
| `--down-volumes` | `docker compose down -v` (stop + borrar datos) |
| `--from-scratch` | `down -v` + `up --build -d` (reset completo) |

### 9.4 Red Docker

Todos los servicios comparten la red `ticketchain-net` (bridge), lo que permite resolución DNS por nombre de servicio.

---

## 10. Entorno Producción (GKE)

### 10.1 Estructura de Manifiestos

```
iac/k8s/
├── cluster-services/
│   ├── config/
│   │   ├── namespace.yaml    → Namespace g-404
│   │   └── configmap.yaml    → ConfigMap ticketchain-config
│   ├── infrastructure/
│   │   ├── postgres-deployment.yaml
│   │   ├── redis-deployment.yaml
│   │   ├── rabbitmq-deployment.yaml
│   │   └── minio-deployment.yaml
│   ├── services/
│   │   ├── auth-deployment.yaml
│   │   ├── event-registry-deployment.yaml
│   │   ├── transaction-api-deployment.yaml
│   │   ├── access-control-deployment.yaml
│   │   ├── status-api-deployment.yaml
│   │   ├── nct-deployment.yaml
│   │   ├── mining-gateway-deployment.yaml
│   │   └── frontend-deployment.yaml
│   └── network/
│       ├── ingress.yaml           → Frontend público (ticketchain404.duckdns.org)
│       ├── api-ingress.yaml       → API routing
│       ├── cluster-issuer.yaml    → Let's Encrypt
│       └── gateway-ingress.yaml   → Mining Gateway (mTLS)
│
└── cluster-mining/
    ├── config/
    │   └── configmap.yaml         → Configuración TrP + workers
    ├── infrastructure/
    │   ├── rabbitmq-deployment.yaml
    │   └── nvidia-device-plugin.yaml
    └── services/
        ├── transaction-pool-deployment.yaml
        ├── worker-cpu-deployment.yaml (con HPA)
        └── worker-gpu-deployment.yaml
```

### 10.2 ConfigMaps

**cluster-services ConfigMap:**

```yaml
REDIS_URL: "redis://redis:6379"
RABBITMQ_URL: "amqp://guest:guest@rabbitmq:5672"
MINIO_ENDPOINT: "minio"
MINIO_PORT: "9000"
MINIO_BUCKET: "ticketchain"
CORS_ORIGIN: "https://ticketchain404.duckdns.org"
MINING_DIFFICULTY: "3"
NODE_ENV: "production"
```

**cluster-mining ConfigMap:**

```yaml
RABBITMQ_URL: "amqp://guest:guest@rabbitmq:5672"
MINING_DIFFICULTY: "3"
GATEWAY_URL: "https://gateway.34.61.108.95.nip.io"
FRAGMENTS: "4"
NONCE_RANGE: "10000000"
KEEPALIVE_TIMEOUT: "30"
```

### 10.3 Secrets

Los secrets se crean manualmente con `kubectl create secret` (nunca se commitean):

```
ticketchain-secrets (cluster-services):
  JWT_SECRET, POSTGRES_USER, POSTGRES_PASSWORD,
  MINIO_ACCESS_KEY, MINIO_SECRET_KEY,
  ADMIN_EMAIL, ADMIN_PASSWORD

ghcr-secret (ambos clusters):
  docker-registry auth para ghcr.io

gateway-tls (cluster-services):
  gateway.crt + gateway.key (mTLS server)

trp-tls (cluster-mining):
  trp.crt + trp.key (mTLS client)

cross-cluster-ca (ambos clusters):
  ca.crt (CA compartida)
```

### 10.4 Recursos por Servicio

| Servicio | CPU request | CPU limit | RAM request | RAM limit | Storage |
|---|---|---|---|---|---|
| postgres | — | — | — | — | 5Gi |
| redis | — | — | — | — | 1Gi |
| rabbitmq | — | — | — | — | 1Gi |
| minio | — | — | — | — | 3Gi |
| auth-service | — | — | — | — | — |
| event-registry | — | — | — | — | — |
| transaction-api | — | — | — | — | — |
| access-control | — | — | — | — | — |
| status-api | — | — | — | — | — |
| nct | — | — | — | — | — |
| mining-gateway | — | — | — | — | — |
| transaction-pool | — | — | — | — | — |
| worker-cpu | 500m | 1 | 256Mi | 512Mi | — |
| worker-gpu | 500m | 1 | 512Mi | 1Gi + 1 GPU | — |
| frontend | — | — | — | — | — |

### 10.5 HPA (Worker CPU)

```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
spec:
  scaleTargetRef:
    name: worker-cpu
  minReplicas: 1
  maxReplicas: 10
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: 70
```

Cuando la carga de trabajo de minería supera el 70% de CPU, K8s escala automáticamente hasta 10 réplicas de workers CPU para mantener el throughput.

---

## 11. Flujo de Datos Completo

### 11.1 Compra de Ticket (Flujo Completo)

```
Browser                    Frontend (React)
   │                            │
   │  POST /api/transactions/buy│
   ├───────────────────────────→│  (JWT en header)
   │                            │
   │                            │  authFetch → nginx/ingress
   │                            │       ↓
   │                            │  transaction-api:3003
   │                            │       ↓
   │                            │  Redis: LPOP ticket from pool
   │                            │  Redis: SET owner = pending_payment (TTL 900s)
   │                            │       ↓
   │                            │  Mercado Pago: POST /v1/payments
   │                            │       ↓
   │←─── init_point (URL pago) ─│
   │                            │
   │  Redirect a Mercado Pago   │
   │       ↓                    │
   │  Usuario paga              │
   │       ↓                    │
   │  MP → Webhook → transaction-api
   │                       ↓
   │              Redis: SET owner = wallet (permanente)
   │              Redis: SET checked_in = false
   │              RabbitMQ: publish tx.new
   │                       ↓
   │              NCT consume → forma bloque
   │                       ↓
   │              RabbitMQ: publish mining task (exchange:mining)
   │                       ↓
   │              Mining Gateway → GET /next-task
   │                       ↓
   │              Transaction Pool → fragmenta nonces
   │                       ↓
   │              RabbitMQ local → Workers CPU/GPU
   │                       ↓
   │              Worker encuentra nonce → TrP ensambla
   │                       ↓
   │              TrP → POST /result → Mining Gateway
   │                       ↓
   │              RabbitMQ: publish nct_results
   │                       ↓
   │              NCT verifica hash + dificultad
   │              Redis: RPUSH blockchain:{event_id}
   │              Redis: SET ticket:owner (confirmado)
   │
   │  ←── 200 OK (ticket asignado)
```

### 11.2 Minería de Bloques (Flujo Interno)

```
[NCT]                                [Mining Gateway]          [Transaction Pool]
   │                                       │                         │
   │  1. Acumula 5 txs o 10s              │                         │
   │  2. Serializa bloque (sin nonce)     │                         │
   │  3. Publica tarea                     │                         │
   │───── exchange:mining ───────────────→│                         │
   │                                      │  4. Consume tarea       │
   │                                      │  5. Almacena en cola    │
   │                                      │                         │
   │                                      │←── GET /next-task ─────│
   │                                      │─── task data ──────────→│
   │                                      │                         │  6. Fragmenta nonce
   │                                      │                         │  7. Publica fragmentos
   │                                      │                         │──── mining_tasks ──→ Workers
   │                                      │                         │←── mining_results ── Workers
   │                                      │                         │  8. Ensambla resultado
   │                                      │←── POST /result ───────│
   │                                      │  9. Publica resultado   │
   │←──── exchange:nct_results ──────────│                         │
   │  10. Verifica hash                   │                         │
   │  11. Persiste en Redis               │                         │
   │  12. Actualiza ownership tickets     │                         │
```

---

## 12. Diagrama de Arquitectura

Ver `docs/arquitectura.html` para el diagrama interactivo con Mermaid.

---

## 13. Comandos de Despliegue

### 13.1 Local (Docker Compose)

```bash
# Inicio rápido
./iac/local/run_local.sh

# Sin rebuild
./iac/local/run_local.sh --no-build

# Reset completo (borra datos y rebuild)
./iac/local/run_local.sh --from-scratch

# Solo logs
./iac/local/run_local.sh --logs

# Detener
./iac/local/run_local.sh --down

# Detener y borrar volúmenes
./iac/local/run_local.sh --down-volumes
```

### 13.2 Build y Push de Imágenes

```bash
# Login (token desde GitHub Settings → Developer settings → Personal access tokens)
echo <TOKEN> | docker login ghcr.io -u RenzRob --password-stdin

# Un servicio individual
docker build --platform linux/amd64 \
  -t ghcr.io/renzrob/<servicio>:latest \
  backend/<servicio>/
docker push ghcr.io/renzrob/<servicio>:latest

# Todos los servicios backend
for svc in worker-cpu worker-gpu transaction-api transaction-pool \
           mining-gateway event-registry status-api access-control auth-service nct; do
    docker build --platform linux/amd64 \
      -t "ghcr.io/renzrob/${svc}:latest" \
      "backend/${svc}/"
    docker push "ghcr.io/renzrob/${svc}:latest"
done

# Frontend + Nginx
docker build --platform linux/amd64 -t ghcr.io/renzrob/frontend:latest frontend/
docker push ghcr.io/renzrob/frontend:latest
```

### 13.3 OpenTofu (Provisioning GKE)

```bash
cd iac/tofu/cluster-services

tofu init       # Primera vez: descarga providers
tofu plan       # Previsualizar cambios
tofu apply      # Crear cluster + node pool + ingress-nginx + cert-manager

# Obtener credenciales del cluster
gcloud container clusters get-credentials app-cluster \
  --region us-central1 --project proyecto-sobel-grupo404

# Destruir todo
tofu destroy
```

### 13.4 K8s — cluster-services (GKE)

```bash
# 1. Namespace + ConfigMap
kubectl apply -f iac/k8s/cluster-services/config/

# 2. Infraestructura (postgres, redis, rabbitmq, minio)
kubectl apply -f iac/k8s/cluster-services/infrastructure/

# 3. Secrets (manual, valores reales)
kubectl create secret generic ticketchain-secrets \
  --from-literal=JWT_SECRET=<valor> \
  --from-literal=POSTGRES_USER=<valor> \
  --from-literal=POSTGRES_PASSWORD=<valor> \
  --from-literal=MINIO_ACCESS_KEY=<valor> \
  --from-literal=MINIO_SECRET_KEY=<valor> \
  --from-literal=ADMIN_EMAIL=<email> \
  --from-literal=ADMIN_PASSWORD=<password> \
  -n g-404

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=RenzRob \
  --docker-password=<TOKEN> -n g-404

# 4. mTLS certs
GATEWAY_HOST=gateway.34.61.108.95.nip.io iac/k8s/certs/gen-certs.sh

kubectl create secret tls gateway-tls \
  --cert=iac/k8s/certs/out/gateway.crt --key=iac/k8s/certs/out/gateway.key -n g-404
kubectl create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt -n g-404

# 5. Microservicios
kubectl apply -f iac/k8s/cluster-services/services/

# 6. Networking (ingress + cluster-issuer)
kubectl apply -f iac/k8s/cluster-services/network/
```

### 13.5 K8s — cluster-mining (g-404)

```bash
# 1. Infraestructura
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/infrastructure/

# 2. ConfigMap
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/config/

# 3. mTLS certs (cliente)
kubectl --kubeconfig=renzo.yaml create secret tls trp-tls \
  --cert=iac/k8s/certs/out/trp.crt --key=iac/k8s/certs/out/trp.key -n g-404
kubectl --kubeconfig=renzo.yaml create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt -n g-404

# 4. Services
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/services/

# Nota: nvidia-device-plugin.yaml requiere cluster-admin → lo aplica el profe
```

### 13.6 Comandos Útiles

```bash
# Logs
kubectl logs -f deployment/mining-gateway -n g-404
kubectl --kubeconfig=renzo.yaml logs -f deployment/transaction-pool -n g-404
kubectl --kubeconfig=renzo.yaml logs -f deployment/worker-cpu -n g-404

# Rollout restart (para tomar nuevos configmaps/secrets)
kubectl rollout restart deployment/nct -n g-404
kubectl --kubeconfig=renzo.yaml rollout restart deployment/transaction-pool -n g-404

# Ver pods
kubectl get pods -n g-404
kubectl --kubeconfig=renzo.yaml get pods -n g-404

# Ver secrets
kubectl get secrets -n g-404
```

---

## 14. Procedimiento de Despliegue Desde Cero

### Paso 1: Provisionar cluster GKE
```bash
cd iac/tofu/cluster-services
tofu init && tofu apply
gcloud container clusters get-credentials app-cluster \
  --region us-central1 --project proyecto-sobel-grupo404
```

### Paso 2: Crear secrets
```bash
kubectl create secret generic ticketchain-secrets ... -n g-404
kubectl create secret docker-registry ghcr-secret ... -n g-404
```

### Paso 3: Desplegar infraestructura base
```bash
kubectl apply -f iac/k8s/cluster-services/config/
kubectl apply -f iac/k8s/cluster-services/infrastructure/
```

### Paso 4: Certificados mTLS
```bash
GATEWAY_HOST=gateway.34.61.108.95.nip.io iac/k8s/certs/gen-certs.sh
kubectl create secret tls gateway-tls ... -n g-404
kubectl create secret generic cross-cluster-ca ... -n g-404
```

### Paso 5: Desplegar microservicios
```bash
kubectl apply -f iac/k8s/cluster-services/services/
kubectl apply -f iac/k8s/cluster-services/network/
```

### Paso 6: Configurar cluster de minería
```bash
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/infrastructure/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/config/
kubectl --kubeconfig=renzo.yaml create secret tls trp-tls ... -n g-404
kubectl --kubeconfig=renzo.yaml create secret generic cross-cluster-ca ... -n g-404
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/services/
```

### Paso 7: Verificar funcionamiento
```bash
# Ver pods levantados
kubectl get pods -n g-404

# Probar health checks
curl https://ticketchain404.duckdns.org/api/status/

# Ver logs del NCT (corazón del sistema)
kubectl logs -f deployment/nct -n g-404
```

---

*Documento generado como parte de la documentación del proyecto TicketChain — Grupo 404 · UNLu · 2026*
