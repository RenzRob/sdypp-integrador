# Redis HA y tolerancia a fallas en TicketChain

TicketChain usa Redis con alta disponibilidad mediante **Redis Sentinel**. Este documento explica la arquitectura, el algoritmo de votación y por qué se eligió ese número de nodos.

---

## Componentes desplegados

```
redis-master-0      StatefulSet — nodo primario de lectura/escritura
redis-replica-0     StatefulSet — réplica de solo lectura, sincronizada con el master
redis-sentinel-0    ┐
redis-sentinel-1    ├─ StatefulSet — monitoran master y replicas, coordinan failover
redis-sentinel-2    ┘
```

Los servicios de la plataforma (event-registry, transaction-api, etc.) no se conectan directamente al master. Se conectan a los sentinels, quienes les informan quién es el master actual. Si el master cambia por un failover, los clientes se reconectan automáticamente sin cambio de configuración.

---

## Qué hace Sentinel

Sentinel tiene tres responsabilidades:

1. **Monitoreo** — hace PING al master y las réplicas cada segundo.
2. **Notificación** — avisa a los clientes cuando el master cambia.
3. **Failover automático** — si el master cae, promueve una réplica a master y reconfigura el resto.

---

## Algoritmo de votación (SDOWN → ODOWN → Failover)

### Fase 1 — Sospecha individual (SDOWN)

Cada sentinel monitorea al master de forma independiente. Si no recibe respuesta en `down-after-milliseconds` (configurado en 5000 ms), lo marca como *Subjectively Down* (caído desde su punto de vista).

```
Sentinel-0: "el master no responde hace 5s → SDOWN"
Sentinel-1: "ídem → SDOWN"
Sentinel-2: "ídem → SDOWN"
```

Una sola opinión no es suficiente para actuar: la red puede tener una partición temporal que solo afecte a un sentinel.

### Fase 2 — Consenso colectivo (ODOWN)

Un sentinel pregunta a los demás si también ven al master caído. Cuando acumula `quorum` votos afirmativos (configurado en 2), lo declara *Objectively Down*: el master se considera oficialmente caído.

```
S0 → S1: "¿ves al master caído?"  →  S1: "sí"
S0 → S2: "¿ves al master caído?"  →  S2: "sí"
S0 acumula 2/2 votos → declara ODOWN
```

### Fase 3 — Elección de líder sentinel

No cualquier sentinel puede ejecutar el failover; primero se eligen entre ellos. Cada sentinel se vota a sí mismo y solicita votos a los demás. El primero en acumular mayoría simple (más de la mitad de los sentinels conocidos) es elegido líder.

```
S0 → S1: "votame, epoch=1"   →  S1: "ok"
S0 → S2: "votame, epoch=1"   →  S2: "ok"
S0 tiene 2 de 3 votos → líder
```

El campo `epoch` (número de elección) evita que votos de rondas anteriores interfieran con una elección nueva. Cada failover incrementa el epoch.

### Fase 4 — Failover

Solo el sentinel líder actúa:

1. Elige la réplica más actualizada (menor replication lag).
2. Le envía `REPLICAOF NO ONE` → pasa a ser el nuevo master.
3. Reconfigura las réplicas restantes para que sigan al nuevo master.
4. Notifica a todos los clientes. Los clientes con soporte Sentinel (como ioredis) se reconectan automáticamente.

---

## Por qué 3 sentinels y no 2

La regla es **2N+1** nodos para tolerar N fallas simultáneas.

| Sentinels | Quorum | Fallas toleradas |
|-----------|--------|-----------------|
| 1         | 1      | 0 (inútil para HA) |
| 2         | 2      | 0 |
| **3**     | **2**  | **1** |
| 5         | 3      | 2 |

Con 2 sentinels y quorum=2, si uno cae:

```
S1 intenta votar → necesita 2 votos → solo tiene 1 → bloqueado indefinidamente
```

El sistema se congela: no puede declarar ODOWN ni hacer failover. Con 3 sentinels, perder uno deja 2 nodos operativos, suficiente para alcanzar quorum=2 y continuar.

---

## Configuración en el cluster (g-404)

```yaml
sentinel resolve-hostnames yes
sentinel announce-hostnames yes
sentinel monitor mymaster redis-master 6379 2
sentinel down-after-milliseconds mymaster 5000
sentinel failover-timeout mymaster 10000
sentinel parallel-syncs mymaster 1
```

- `resolve-hostnames yes` — requerido en Redis 7.x para usar hostnames en lugar de IPs.
- `parallel-syncs 1` — durante el failover, solo una réplica sincroniza a la vez para no saturar la red.
- `failover-timeout 10000` — si el failover no termina en 10 s, se reintenta.

---

## Bug encontrado y corregido (2026-06-26)

Redis 7.x introdujo el flag `sentinel resolve-hostnames` que está desactivado por defecto. Sin él, Sentinel falla al parsear cualquier hostname en `sentinel monitor` y entra en CrashLoopBackOff:

```
*** FATAL CONFIG FILE ERROR (Redis 7.4.9) ***
Reading the configuration file, at line 1
>>> 'sentinel monitor mymaster redis-master 6379 2'
Can't resolve instance hostname.
```

Al estar los 3 sentinels caídos, los servicios (event-registry, transaction-api, etc.) no podían conectarse a Redis. Las requests a `/api/events/` quedaban colgadas indefinidamente, causando que el frontend se quedara en "Cargando eventos…".

**Fix:** agregar `sentinel resolve-hostnames yes` y `sentinel announce-hostnames yes` como primeras líneas del config antes de `sentinel monitor`.
