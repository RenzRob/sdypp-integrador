# Prueba de carga — TicketChain

## ¿Qué es k6?

k6 es una herramienta de código abierto para hacer pruebas de carga. Permite simular muchos usuarios haciendo requests a una API al mismo tiempo y medir cómo responde el sistema: cuántos requests por minuto soporta, cuánto tarda cada endpoint, cuántos errores hay bajo presión.

Los scripts se escriben en JavaScript. k6 corre desde tu máquina y dispara los requests contra el servidor remoto.

---

## Setup previo (una sola vez)

### 1. Instalar k6

```bash
brew install k6
```

### 2. Instalar dependencia Python

```bash
pip install requests
```

### 3. Crear los datos de test

Este script crea los eventos de stress en el servidor y loguea al usuario de carga (que ya existe en la base de datos, seeded via secrets). Guarda todo en `test-data.json` para que k6 lo use directamente.

```bash
cd load-tests/

python3 setup.py \
  --base-url           https://ticketchain404.duckdns.org \
  --admin-email        admin@ticketchain.com \
  --admin-password     <PASSWORD_ADMIN> \
  --load-test-email    loadtest@ticketchain.com \
  --load-test-password <PASSWORD_LOAD_TEST> \
  --events             5 \
  --tickets-per-event  25000
```

Crea **5 eventos × 25.000 tickets** y obtiene el JWT del usuario de carga. Tarda ~1 minuto porque el servidor inicializa los tickets en Redis.

> El usuario de carga (`loadtest@ticketchain.com`) es creado automáticamente por el auth-service al arrancar, igual que el admin y el scanner. No hace falta registrarlo a mano.

---

## Correr el stress test

```bash
# Test completo: 5.000 RPM durante 30 minutos
k6 run stress-test.js

# Guardando resultados para analizar después
k6 run --out json=results/run.json stress-test.js
```

### Variantes útiles

```bash
# Warm-up rápido (500 RPM × 2 minutos) — para verificar que todo funciona
k6 run -e RATE=500 -e DURATION=2m stress-test.js

# Carga media (2.000 RPM × 10 minutos)
k6 run -e RATE=2000 -e DURATION=10m stress-test.js

# Test completo con más presión en blockchain (50% confirman en vez de 30%)
k6 run -e CONFIRM=0.50 stress-test.js
```

---

## Qué hace cada iteración

```
1. Elige un usuario y un evento al azar (de test-data.json)
2. POST /api/transactions/buy  →  reserva un ticket por 15 min
3. 70%: cancela  →  el ticket vuelve al pool (recicla inventario)
   30%: confirma →  la transacción va a RabbitMQ → NCT → minero → blockchain
```

La mezcla 70/30 permite que el test corra los 30 minutos completos sin agotar los tickets.

---

## Leer los resultados

Al terminar, k6 imprime una tabla como esta:

```
╔══════════════════════════════════════════════════════════════╗
║          TICKETCHAIN — STRESS TEST RESULTS                   ║
╠══════════════════════════════════════════════════════════════╣
║  Duración total         1800s (30.0 min)                     ║
║  Total HTTP reqs        450.000                              ║
║  RPM promedio           15.000 req/min                       ║
╠══════════════════════════════════════════════════════════════╣
║  TASAS DE ÉXITO                                              ║
║  Buy success            98.8%                                ║
║  Confirm success        97.2%                                ║
║  Txs → blockchain       44.580                               ║
╠══════════════════════════════════════════════════════════════╣
║  LATENCIAS                                                   ║
║  /buy       p95         631 ms                               ║
║  /confirm   p95         892 ms                               ║
╠══════════════════════════════════════════════════════════════╣
║  THRESHOLDS: ✅ TODOS PASARON                                ║
╚══════════════════════════════════════════════════════════════╝
```

### Qué mirar

| Métrica | Qué significa | Valor esperado |
|---|---|---|
| **Buy success** | % de compras que el servidor aceptó | ≥ 95% |
| **p95 /buy** | El 95% de los buy respondió en menos de X ms | < 2.000 ms |
| **p95 /confirm** | Ídem para confirmaciones (más lento por blockchain) | < 3.000 ms |
| **Txs → blockchain** | Transacciones reales minadas durante el test | ~30% del total |
| **tc_tickets_exhausted** | Veces que no había tickets (409) | Cercano a 0 |

---

## Ver el sistema en vivo (Grafana)

Mientras el test corre, abrí el dashboard en:

**https://ticketchain404.duckdns.org/grafana/** → `TicketChain — Stress Test`

Paneles a observar:
- **RPM — transaction-api**: debería mostrar ~5.000
- **Cola: transactions_q**: sube durante el test, baja a medida que el NCT mina bloques
- **HPA — Réplicas activas**: el autoscaler escala `transaction-api` de 1 a 4 pods automáticamente
- **CPU millicores**: pico durante la carga
