# TicketChain — Pruebas de Carga

Stress test de 5.000 RPM durante 30 minutos contra la plataforma TicketChain en producción.

## Stack

| Herramienta | Rol |
|---|---|
| **k6** | Motor de carga — genera 5.000 iteraciones/min con `constant-arrival-rate` |
| **Python 3** | Setup — crea eventos y usuarios de test vía API |

---

## Prerequisitos

```bash
# macOS
brew install k6

# Python (solo para el setup)
pip install requests
```

Verificar instalación:
```bash
k6 version       # k6 v0.50+ recomendado
python3 --version
```

---

## Flujo completo

### Paso 1 — Crear datos de test

El script `setup.py` crea los eventos y usuarios que k6 va a usar. Se conecta a la API como admin, crea N eventos con muchos tickets, registra 100 usuarios de test y guarda todo en `test-data.json`.

```bash
cd load-tests/

python3 setup.py \
  --base-url      https://ticketchain404.duckdns.org \
  --admin-email   admin@ticketchain.com \
  --admin-password <TU_PASSWORD_ADMIN> \
  --events        5 \
  --tickets-per-event 25000 \
  --users         100
```

Salida esperada:
```
╔══════════════════════════════════════════════════════════╗
║        TicketChain — Stress Test Setup                  ║
╚══════════════════════════════════════════════════════════╝
  Eventos:            5 × 25.000 tickets
  Total tickets:      125.000
  Usuarios de test:   100

▶  [1/4] Login como admin...
   ✓  Admin autenticado

▶  [2/4] Creando 5 evento(s)...
   [1/5] 'StressTest-01-1719000000'... ✓  (12.3s) → a1b2c3d4…
   ...
▶  [3/4] Creando 100 usuarios de test...
▶  [4/4] Guardando test-data.json...
```

> **Nota sobre el tiempo de creación:** Cada evento inicializa sus tickets en Redis (en batches de 1.000). Con 25.000 tickets ≈ 10-15 segundos por evento. Con 5 eventos el setup total tarda ~1 minuto.

---

### Paso 2 — Correr el stress test

```bash
# Test básico (5.000 RPM × 30 min)
k6 run stress-test.js

# Guardar resultados en JSON para análisis
k6 run --out json=results/run-$(date +%Y%m%d-%H%M).json stress-test.js

# Reducir la carga para probar primero (1.000 RPM × 5 min)
k6 run -e RATE=1000 -e DURATION=5m stress-test.js
```

### Parámetros configurables (via `-e`)

| Variable | Default | Descripción |
|---|---|---|
| `RATE` | `5000` | Iteraciones por minuto (= buy-requests / min) |
| `DURATION` | `30m` | Duración total del test |
| `CONFIRM` | `0.30` | Fracción de requests que confirman (van a blockchain) |

Ejemplos:
```bash
# Test corto de warm-up (2 min)
k6 run -e RATE=500 -e DURATION=2m stress-test.js

# Subir la presión sobre blockchain (50% confirm en vez de 30%)
k6 run -e CONFIRM=0.50 stress-test.js

# Test de resistencia a máxima carga (60 minutos)
k6 run -e RATE=5000 -e DURATION=60m stress-test.js
```

---

## Qué hace el script

Cada **iteración** (VU) ejecuta:

```
1. Elige un usuario random de test-data.json (JWT pre-fetched)
2. Elige un evento random de test-data.json
3. POST /api/transactions/buy {event_id}
     → Si 409 (sin tickets): registra como "agotado" y termina iteración
     → Si 200: obtiene {tx_id, ticket_id, price}
4. (70%) DELETE /api/transactions/checkout/{tx_id}   ← CANCEL
             El ticket vuelve al pool → recicla inventario
   (30%) POST /api/transactions/checkout/confirm {tx_id}  ← CONFIRM
             Ticket queda asignado → tx va a RabbitMQ → NCT → blockchain
```

### Por qué esta mezcla

| Operación | % | Qué estresa |
|---|---|---|
| buy | 100% | JWT validation · Redis reads · available_tickets |
| cancel | 70% | Redis writes · ticket pool recycling |
| confirm | 30% | Redis writes · RabbitMQ publish · NCT · Proof of Work |

El cancel recicla los tickets al pool, permitiendo que el test corra indefinidamente sin agotar el inventario. El confirm (30%) genera transacciones reales que van al pipeline de minería y se ven en Grafana como profundidad de colas.

---

## Interpretación de resultados

### Output en tiempo real

k6 imprime cada 10 segundos mientras corre:

```
✓ buy → 200
✓ buy → tiene tx_id
✓ confirm → 200

tc_buy_latency_ms.................................................: avg=243ms min=87ms med=198ms max=3421ms p(90)=412ms p(95)=631ms
tc_buy_ok_rate....................................................: 98.72% ✓ 49360 ✗ 640
tc_confirmed_txs..................................................: 14821
tc_tickets_exhausted..............................................: 12
http_req_duration.................................................: avg=251ms
```

### Resumen final (tabla)

Al terminar el test se muestra:

```
╔══════════════════════════════════════════════════════════════╗
║          TICKETCHAIN — STRESS TEST RESULTS                   ║
╠══════════════════════════════════════════════════════════════╣
║  Duración total         1800s (30.0 min)                     ║
║  Total HTTP reqs        450000                               ║
║  RPM promedio           15000 req/min                        ║  ← buy + confirm/cancel
╠══════════════════════════════════════════════════════════════╣
║  TASAS DE ÉXITO                                              ║
║  Buy success            98.8%                                ║
║  Confirm success        97.2%                                ║
║  Cancel success         99.9%                                ║
║  Txs → blockchain       44580                                ║
║  Txs canceladas         104020  (ticket reciclado)           ║
╠══════════════════════════════════════════════════════════════╣
║  LATENCIAS                                                   ║
║  /buy       p50         198 ms                               ║
║  /buy       p95         631 ms                               ║
║  /buy       p99         1240 ms                              ║
║  /confirm   p95         892 ms                               ║
╚══════════════════════════════════════════════════════════════╝
```

### Thresholds de fallo

El test falla (exit code 1) si:

| Threshold | Condición de fallo |
|---|---|
| `tc_buy_ok_rate` | Tasa de éxito del buy cae por debajo del 95% |
| `tc_buy_latency_ms p(95)` | P95 del buy supera 2.000 ms |
| `tc_confirm_latency_ms p(95)` | P95 del confirm supera 3.000 ms |
| `http_req_failed` | Más del 5% de requests HTTP fallan |

---

## Ver métricas en Grafana durante el test

Si el test corre mientras Grafana está activo, podés ver en tiempo real:

- **Panel "RPM — transaction-api":** debería mostrar ~5.000 RPM
- **Panel "Cola: transactions_q":** sube durante la carga, baja al confirmar bloques
- **Panel "HPA — Réplicas activas":** verás cómo el autoscaler escala `transaction-api` (min 1, max 4)
- **Panel "CPU millicores":** pico de CPU en `transaction-api` durante el test

URL del dashboard: https://ticketchain404.duckdns.org/grafana/

---

## Estructura de archivos

```
load-tests/
├── setup.py          — crea eventos + usuarios, genera test-data.json
├── stress-test.js    — script k6: 5.000 RPM × 30 min
├── test-data.json    — generado por setup.py (IGNORADO EN GIT)
├── results/          — JSONs de resultados (IGNORADO EN GIT)
│   └── summary.json  — generado automáticamente al finalizar cada run
└── README.md
```

> `test-data.json` y `results/` están en `.gitignore` — contienen tokens y datos efímeros.

---

## Troubleshooting

### "dropped iterations" en k6

Los VUs no pueden generar 5.000 iteraciones/min porque la latencia es muy alta o los VUs están agotados. El sistema probablemente está al límite.

```
WARN[0060] some iterations did not complete, possible causes: insufficient VUs, ...
```

→ El sistema llegó a su límite real. Ese es el punto de quiebre que queremos encontrar.

### 409 "Evento no disponible" (tc_tickets_exhausted alto)

El pool de tickets del evento se agotó. El cancel no recicló tickets a tiempo.

→ Correr setup.py con más tickets (`--tickets-per-event 50000`) o más eventos (`--events 10`).

### Latencias P95 > 2s

→ Ver el dashboard de Grafana: ¿HPA llegó a max réplicas? ¿La cola de RabbitMQ crece sin límite? ¿CPU de Redis al tope?

### Tokens expirados (401 en `tc_auth_errors`)

Los JWTs duran 24 horas. Si el test se corre más de 24 horas después del setup, los tokens expiran.

→ Correr `setup.py` nuevamente antes del test.
