# TicketChain — Idea del Proyecto

> Trabajo Práctico Integrador — Sistemas Distribuidos y Programación Paralela 2026  
> Universidad Nacional de Luján — Dr. David Petrocelli

---

## Concepto

**TicketChain** es una plataforma de ticketing descentralizada que usa blockchain propia
para registrar la emisión y transferencia de entradas a eventos de forma inmutable.

El problema que resuelve: en el mercado secundario de entradas (recitales, partidos,
teatro) no hay forma de saber cuántas veces fue revendida una entrada, a qué precio,
ni si el QR que recibiste ya le fue vendido a otra persona. Las plataformas centralizadas
(Ticketek, etc.) pueden borrar historial, alterar precios y no ofrecen transparencia.

**La solución**: cada entrada es una transacción en una blockchain. El historial de
compra y reventa es público, inmutable y verificable por cualquiera — sin depender
de que una empresa centralizada esté disponible o sea honesta.

---

## Modelo de transacción

Cada transferencia de entrada tiene la forma:

```json
{
  "from":        "productora_luna_park",
  "to":          "usuario_0x4f3a",
  "evento_id":   "lp-rolling-stones-2026-10-15",
  "entrada_id":  "SECTOR-A-FILA-12-ASIENTO-5",
  "precio":      15000,
  "timestamp":   "2026-05-25T14:32:00Z"
}
```

---

## Decisión de arquitectura: una cadena por evento (Option B)

Cada evento tiene su propia blockchain en Redis, sus propias colas en RabbitMQ
y sus propios workers asignados. Cuando el evento termina, su cadena se archiva.

```
blockchain:lp-rolling-stones-2026-10-15  → bloque 1, 2, 3...
blockchain:river-racing-2026-11-20       → bloque 1, 2, 3...
blockchain:show-charly-garcia-2026-09-01 → bloque 1, 2, 3...
```

**Por qué esta decisión:**
- Aislamiento total: un evento con pico de demanda no afecta a otros
- Permite escalar workers por evento según demanda en Kubernetes
- Justifica el uso de exchanges separados en RabbitMQ
- Al terminar el evento, la cadena se archiva → no crece indefinidamente

---

## Reglas de negocio configurables por creador

Cada creador define las reglas de su evento al crearlo. Quedan registradas
en el **bloque génesis** de esa blockchain — inmutables desde ese momento.

| Regla           | Descripción                                              |
|-----------------|----------------------------------------------------------|
| `precio_max`    | Tope de precio en reventas (ej: 150% del valor original) |
| `max_reventas`  | Máximo de veces que una entrada puede revenderse         |
| `nominada`      | Si es nominada, no se puede transferir                   |
| `ventana_venta` | Hasta cuándo se puede revender (ej: 24hs antes)          |

---

## Actores del sistema

| Actor                | Rol                                                              |
|----------------------|------------------------------------------------------------------|
| **TicketChain**      | Opera la blockchain, los nodos y la infraestructura              |
| **Creador de evento**| Se registra, crea eventos, define reglas, emite entradas         |
| **Comprador**        | Compra entradas en venta primaria y puede revenderlas            |
| **Control de acceso**| Valida entradas en la puerta consultando Redis                   |

---

## Ciclo de vida de un evento

```
1. REGISTRO    → Creador se registra con API key
2. CREACIÓN    → Define evento + reglas → bloque génesis en la blockchain
3. EMISIÓN     → N entradas emitidas como txs: productora → null (sin dueño)
4. VENTA       → Usuario compra → tx: null → usuario, precio validado
5. REVENTA     → Usuario revende → tx: userA → userB, precio <= precio_max
6. ACCESO      → Control valida en Redis quién es el dueño actual del entrada_id
7. CIERRE      → Blockchain archivada en cold storage
```

---

## Microservicios

### Definidos por el TP (Pilar 2)

| Servicio                    | Responsabilidad                                          |
|-----------------------------|----------------------------------------------------------|
| **NCT** (Nodo Coordinador)  | Valida txs, forma bloques, publica tareas en RabbitMQ    |
| **Transaction Pool (TrP)**  | Fragmenta rangos de nonce entre workers, maneja keepalive|
| **Worker GPU**              | Mina con CUDA — C/C++                                    |
| **Worker CPU**              | Fallback Python, se levanta si no hay GPU                |

### Agregados por la plataforma

| Servicio                | Responsabilidad                                              |
|-------------------------|--------------------------------------------------------------|
| **API Gateway**         | Punto de entrada único, autenticación, rate limiting         |
| **Event Registry**      | CRUD de creadores y eventos, genera bloque génesis           |
| **Transaction API**     | Recibe compras y reventas, las encola para el NCT            |
| **Access Control API**  | Valida una entrada en la puerta (consulta Redis)             |
| **Status API**          | Health check de todos los servicios (requerido por el TP)    |

---

## Stack tecnológico

| Componente         | Tecnología                         |
|--------------------|------------------------------------|
| Minero GPU         | C/C++ + CUDA                       |
| Minero CPU         | Python (`hashlib`)                 |
| Todos los servicios| Python + FastAPI                   |
| Cola de mensajes   | RabbitMQ (exchange por evento)     |
| Base de datos      | Redis con persistencia             |
| Orquestación       | Kubernetes (GKE)                   |
| Infra como código  | OpenTofu                           |
| CI/CD              | GitHub Actions                     |
| Algoritmo de hash  | MD5 (TP) — SHA-256 en producción   |
| Consenso           | Proof of Work (PoW)                |

---

## Arquitectura completa

```
                        INTERNET
                           │
                    ┌──────▼──────┐
                    │ API Gateway  │
                    └──┬───────┬──┘
                       │       │
          ┌────────────▼─┐  ┌──▼──────────────┐
          │ Event Registry│  │ Transaction API  │
          └────────────┬──┘  └──┬──────────────┘
                       │        │
                    ┌──▼────────▼──┐
                    │     NCT      │  ← una instancia por evento activo
                    └──────┬───────┘
                           │
                    ┌──────▼───────┐
                    │   RabbitMQ   │  ← exchange por evento
                    └──┬───────┬───┘
               ┌───────▼─┐ ┌───▼──────┐
               │   TrP   │ │   TrP    │  ← uno por evento
               └───┬─────┘ └────┬─────┘
              ┌────▼──┐    ┌────▼──┐
              │Worker │    │Worker │  ← GPU o CPU según disponibilidad
              └───────┘    └───────┘
                                │
                    ┌───────────▼──┐
                    │    Redis     │  ← blockchain:{evento_id}
                    └──────────────┘
                           │
                    ┌──────▼───────┐
                    │ Access Ctrl  │
                    └──────────────┘
```

---

## Estructura del repositorio

```
ticketchain/
├── IDEA.md                        ← este archivo
├── pilar1-miner/
│   ├── gpu/                       ← C/C++ CUDA (hits #2 al #7)
│   ├── cpu/                       ← Python fallback
│   └── README.md
├── pilar2-services/
│   ├── api-gateway/
│   ├── event-registry/
│   ├── transaction-api/
│   ├── nct/
│   ├── transaction-pool/
│   ├── worker-cpu/
│   ├── worker-gpu/                ← wrapper que llama al binario CUDA
│   ├── access-control/
│   ├── status-api/
│   ├── docker-compose.yml
│   └── README.md
├── pilar3-deploy/
│   ├── opentofu/
│   ├── k8s/
│   ├── pipelines/
│   ├── tests/
│   └── README.md
└── informe/
```

---

## Conexión entre pilares

- El **Hit #7** del Pilar 1 (`hit7_range_miner`) es el binario que el Worker GPU
  del Pilar 2 llama vía `subprocess`. Imprime `RESULT:NONCE=X:HASH=Y` y retorna
  exit code `0` (encontró) o `1` (no encontró en el rango).
- El **Worker CPU** del Pilar 2 usa `miner.py` con `--start` y `--end`.
- El **TrP** decide qué rangos asignar a cada worker según los keepalives recibidos.
- El **NCT** es quien verifica la solución y la persiste en Redis al confirmar un bloque.
