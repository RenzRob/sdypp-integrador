# TicketChain — Guía de Exposición Oral

**Materia:** Sistemas Distribuidos — UNLu 2026 · Grupo 404  
**Tiempo estimado:** 30–40 min + preguntas  
**Formato:** 14 slides · navegar con `→` o `Space`

---

## Slide 1 — Portada

### Qué decir

> "TicketChain es una plataforma de ticketing descentralizada que construimos sobre una blockchain propia, desplegada en dos clusters Kubernetes, con minería GPU/CPU y un mercado secundario con reglas inmutables."

### Puntos clave a mencionar
- El sistema está **corriendo en producción**: `https://ticketchain404.duckdns.org`
- Stack: React 18 + Node.js + Python + CUDA — elegido por alinearse a los tres pilares del TP
- Infraestructura real: GKE (Google Cloud) + k3s externo
- Pilar 1: CUDA (minería GPU) · Pilar 2: microservicios distribuidos · Pilar 3: K8s + pruebas de carga

### Tip
No entrar en detalles técnicos aquí. Es la presentación del problema a resolver. Generar contexto.

---

## Slide 2 — El Problema

### Qué decir

> "El mercado de tickets tiene tres problemas estructurales que ninguna plataforma centralizada resuelve hoy, y que son el origen de todo el diseño de TicketChain."

### Desarrollo por problema

**1. Reventa sin control** 🔴  
- Bots compran entradas en masa, se revenden a 3x–5x el valor
- Las plataformas cobran comisión en ambas ventas → no tienen incentivo a frenarlos
- No existe techo de precio en ninguna plataforma actual

**2. Doble venta con QR** 🟠  
- Alguien compra un ticket, captura su QR, y lo vende múltiples veces
- El primer comprador entra, los demás quedan en la puerta
- El sistema no sabe quién es el dueño *legítimo en tiempo real*

**3. Plataformas centralizadas** 🟣  
- Ticketmaster, StubHub, etc. son la única fuente de verdad
- Pueden modificar datos, cancelar ventas, retener dinero **unilateralmente**
- No hay auditoría pública, ni inmutabilidad

### Por qué es importante mencionarlo
Establece la motivación de *cada* decisión de diseño que viene después. Cuando expliquen el génesis inmutable o el secreto único del QR, el jurado ya tiene el "para qué".

---

## Slide 3 — La Solución

### Qué decir

> "La respuesta a los tres problemas es una blockchain propia por evento. No una blockchain compartida: cada evento es una cadena independiente."

### Por qué blockchain y no una base de datos normal

| Decisión | Justificación |
|---|---|
| **Blockchain propia** en lugar de base de datos | Una BD puede ser modificada por el admin. La cadena con PoW no: alterar un bloque invalida todos los siguientes |
| **Una cadena por evento** en lugar de global | Aislamiento total: las reglas y transacciones de un evento no interfieren con las de otro. Mayor escalabilidad horizontal |
| **Bloque génesis con reglas** | Las restricciones (`precio_max`, `max_reventas`, modo nominado) se graban *antes* de vender el primer ticket. Son inmutables desde el día 0 |

### Cómo resuelve cada problema

- **Reventa sin control →** La regla `precio_max` en el génesis limita la reventa al X% del precio original. El sistema *rechaza* cualquier listing que lo supere. No es una política: es código que no puede desactivarse.
- **Doble venta QR →** El QR es un JWT de 60 segundos firmado con un secreto único por ticket. Al transferir, el secreto se elimina. El scanner verifica firma + propietario actual + flag anti-replay.
- **Plataformas centralizadas →** La blockchain es la fuente de verdad. Ni el admin puede modificar un bloque ya minado.

---

## Slide 4 — Arquitectura: Dos Clusters Kubernetes

### Qué decir

> "La arquitectura central es la separación en dos clusters Kubernetes con propósitos radicalmente distintos."

### cluster-services (GKE — Google Cloud)

**Namespace:** `g-404` — **Proyecto:** `proyecto-sobel-grupo404`

| Servicio | Puerto | Rol |
|---|---|---|
| Frontend | — | React 18 + Vite + Nginx |
| auth-service | :3001 | JWT + bcrypt — registro y login |
| event-registry | :3002 | Crea eventos y el bloque génesis |
| transaction-api | :3003 | Compras + QR — tiene HPA |
| access-control | :3004 | Scanner QR — tiene HPA |
| status-api | :3005 | Health checks + info del sistema |
| NCT (Node Coordinator) | :8000 | Core blockchain — Python/FastAPI |
| mining-gateway | :8001 | Endpoint mTLS para el cluster minero |
| Redis Master + Réplica + 3 Sentinels | :6379 | Fuente de verdad del estado activo |
| RabbitMQ | :5672 | 4 exchanges — mensajería asíncrona |
| PostgreSQL | :5432 | Usuarios y wallets |
| Prometheus + Grafana | namespace monitoring | Observabilidad |

### cluster-mining (k3s — externo)

| Servicio | Rol |
|---|---|
| Transaction Pool (TrP) | Python — distribuye tareas a workers |
| Worker GPU | C/CUDA — nvidia-device-plugin |
| Worker CPU | Python — hashlib multicore |
| RabbitMQ local | exchanges: `mining_tasks` + `nct_results` |

### Por qué dos clusters separados

La decisión más importante de la arquitectura:

- **Hardware heterogéneo:** el cluster de minería puede tener GPUs especializadas sin que eso afecte al clúster de servicios de usuario
- **Aislamiento de fallos:** si el cluster de minería cae, los usuarios siguen comprando y los datos quedan en cola. No hay impacto visible
- **Seguridad por separación:** el cluster de minería nunca expone endpoints públicos. Modifica el modelo de amenaza fundamentalmente
- **Escalabilidad independiente:** se puede escalar el poder de minería sin tocar la infraestructura de usuario

### Modelo PULL — la clave del diseño

> "El cluster-mining **nunca** expone endpoints públicos. El Transaction Pool *sale a buscar* tareas al mining-gateway de GKE cada ~20 segundos. Ningún RabbitMQ se expone a Internet."

---

## Slide 5 — RabbitMQ: Colas y Flujo de Datos

### Qué decir

> "RabbitMQ es el sistema nervioso del pipeline de minería. Hay cuatro colas con roles específicos y el flujo es completamente asíncrono."

### Las cuatro colas

**`transactions_q`** (azul)  
- Publicador: `transaction-api` al confirmar un pago  
- Consumidor: NCT  
- Propósito: la API confirma la compra al usuario en <100ms. Que el bloque tarde 10 segundos en minarse no bloquea la experiencia

**`mining_gateway_q`** (violeta)  
- Publicador: NCT (cuando acumula ≥5 txs *o* pasan 10 segundos)  
- Consumidor: Mining Gateway (vía PULL del Transaction Pool con mTLS)  
- Propósito: entregar el bloque candidato al cluster minero sin exponer RabbitMQ a Internet

**`mining_tasks`** (verde — local al cluster minero)  
- Publicador: Transaction Pool  
- Consumidor: Workers CPU y GPU  
- Propósito: paralelizar el cómputo MD5 distribuyendo rangos de nonces distintos a cada worker (no repiten trabajo)

**`nct_results_q`** (amarillo)  
- Publicador: el primer worker que encuentra el nonce válido  
- Consumidor: NCT  
- Propósito: devolver el bloque minado con ACK explícito. Si el bloque es inválido: NACK y no se persiste

### Flujo completo

```
tx-api → transactions_q → NCT → mining_gateway_q → Gateway
TrP (PULL mTLS) → mining_tasks → Workers
Workers → nct_results_q → NCT → Redis blockchain:{eid}
```

### Por qué no llamadas directas entre servicios

- **Desacoplamiento:** la API responde al usuario sin esperar a que el bloque se mine
- **Durabilidad:** si el NCT cae, los mensajes esperan en cola. No se pierde ninguna transacción
- **ACK explícito:** un bloque inválido recibe NACK y nunca se persiste en la blockchain
- **Absorción de picos:** en un concierto masivo, la cola actúa de buffer entre la ola de compras y el pipeline de minería

---

## Slide 6 — Comunicación entre Clusters

### Qué decir

> "Los dos clusters se comunican solo en dos momentos exactos, siempre iniciados desde el cluster de minería, nunca al revés."

### Cuándo se comunican

1. El Transaction Pool hace `GET /next-task` al mining-gateway cada ~20 segundos
2. Cuando un worker encontró el hash válido: el TrP hace `POST /result` al mining-gateway

**No hay comunicación inversa:** GKE nunca inicia conexiones al cluster de minería. Modelo 100% PULL.

```
NCT → queue:mining → mining-gateway ← GET /next-task ← TrP → workers
mining-gateway ← POST /result ← TrP
mining-gateway → queue:nct_results → NCT
```

### Por qué es segura esta comunicación

- **mTLS mutuo:** el mining-gateway exige que el TrP presente un certificado de cliente firmado por nuestra CA interna. Ambas partes se autentican criptográficamente
- **CA propia:** generada con `gen-certs.sh`. La CA no está en git. Los certs se cargan como K8s Secrets
- **HTTPS end-to-end:** el tráfico viaja cifrado sobre Internet. No hay intercepción posible
- **Sin exposición de RabbitMQ:** el broker nunca tiene puerto público. El gateway actúa como proxy seguro

### Decisión de diseño: por qué PULL y no PUSH

- Si GKE hiciera PUSH al cluster de minería, necesitaría saber la IP del cluster externo → exposición innecesaria
- El modelo PULL invierte la iniciativa: quien tiene menos privilegios (el cluster minero) *pide* trabajo, nunca *recibe* conexiones entrantes
- Es el mismo principio de un agent de CI: el runner sale a buscar jobs, el servidor nunca empuja

---

## Slide 7 — ¿Qué es mTLS y por qué importa?

### Qué decir

> "mTLS es TLS mutuo: en lugar de que solo el servidor se autentique, ambos lados presentan certificados. Para el inter-cluster, esto es fundamental."

### TLS estándar vs mTLS

| | TLS estándar (HTTPS) | mTLS mutuo |
|---|---|---|
| ¿Quién presenta cert? | Solo el servidor | Servidor Y cliente |
| ¿Se autentica el cliente? | No criptográficamente | Sí, con cert firmado por la CA |
| ¿Puede cualquiera conectarse? | Sí | No — sin cert válido: conexión rechazada |

### En TicketChain

Solo el Transaction Pool tiene el certificado de cliente firmado por nuestra CA. Un atacante externo que intente `GET /next-task` al mining-gateway recibe un error TLS antes de llegar a la aplicación.

### Implementación concreta

| Componente | Certificado |
|---|---|
| Frontend + APIs | HTTPS con Let's Encrypt (cert-manager en GKE) · Dominio: `ticketchain404.duckdns.org` |
| Mining-gateway (servidor) | Cert firmado por CA interna · Cargado en K8s Secret `gateway-tls` |
| Transaction Pool (cliente) | Presenta `trp.crt` en cada request · Secret `trp-tls` en cluster k3s |
| Validación cruzada | Cada lado verifica la CA del otro con Secret `cross-cluster-ca` |

### Valor de seguridad

- Ni el gateway acepta certs externos, ni el TrP acepta gateways falsos
- La CA no está en git: comprometer el repositorio no da acceso al inter-cluster
- Es el mismo modelo que usan servicios de producción enterprise (Istio, Envoy)

---

## Slide 8 — Decisión de Diseño: Por qué No Exponer RabbitMQ

### Qué decir

> "Esta es quizás la decisión de diseño más importante de la comunicación inter-cluster. Comparemos las dos alternativas."

### Alternativa descartada: RabbitMQ expuesto a Internet

❌ Cualquier actor malicioso podría publicar tareas de minería falsas o bloques inválidos directamente en la cola  
❌ Podría consumir tareas legítimas antes que los workers reales, frenando el pipeline  
❌ El protocolo AMQP depende solo de usuario/contraseña — no verifica la identidad del cliente a nivel de red  
❌ Ataques de amplificación y denegación de servicio son triviales contra un broker de mensajería público

### Alternativa elegida: PULL + mining-gateway

✅ El broker nunca tiene puerto público. Solo es accesible dentro del cluster  
✅ El único endpoint público es el mining-gateway, protegido con mTLS  
✅ El gateway valida que el resultado tiene el hash correcto (dificultad 3) antes de encolarlo  
✅ **Superficie de ataque mínima:** un solo endpoint, con autenticación criptográfica bilateral, que además valida el trabajo antes de aceptarlo

### El principio de diseño detrás

> "Si no necesita ser público, no lo es."

Este principio aplica a toda la arquitectura: PostgreSQL, Redis, RabbitMQ y el NCT nunca tienen IPs públicas. Solo el ingress-nginx y el mining-gateway están expuestos, y ambos con TLS obligatorio.

---

## Slide 9 — QR Dinámico: Secreto Único por Ticket

### Qué decir

> "El mecanismo anti-doble-venta es la parte más interesante del sistema, y combina criptografía asimétrica con gestión de estado en Redis."

### El problema que resuelve

Un JWT normal se firma con el `JWT_SECRET` global del servidor — el mismo para todos. Si alguien captura su QR antes de venderlo, puede usarlo igual, porque el secreto sigue siendo válido.

### La solución: secreto por ticket

**Paso 1 — Primera vez que el dueño pide su QR:**
```
SET ticket:{eid}:{tid}:qr_secret  "a3f9d2e18b4c5f670c1d2e3f..."
```
32 bytes aleatorios (`crypto.randomBytes(32)`). Sin relación con el JWT_SECRET global.

**Paso 2 — Generación del QR:**
```javascript
jwt.sign(
  { event_id, ticket_id, wallet },
  qr_secret,        // el secreto del ticket, no el global
  { expiresIn: 60 } // expira en 60 segundos
)
```

**Paso 3 — Verificación en la puerta:**
El scanner lee `ticket_id` del JWT → busca en Redis el `qr_secret` de ese ticket → verifica la firma. Si no coincide: `401 QR inválido`.

### El momento clave: la transferencia

```
DEL ticket:{eid}:{tid}:qr_secret
```

Al cambiar de dueño, el secreto desaparece de Redis. Si el vendedor intenta usar su captura de pantalla:
- El scanner busca `qr_secret` → no existe → `401 QR inválido`
- El nuevo dueño pide su QR → se genera un **nuevo secreto completamente distinto**

### Por qué no alcanza con el TTL de 60 segundos

El TTL evita que alguien use un QR de hace 2 minutos. **Pero no evita que el vendedor use su QR vigente justo antes de que expire**, entrando él mientras el comprador legítimo queda afuera.

El secreto único resuelve esto: **al momento de la venta, el QR del vendedor deja de existir**, independientemente de su tiempo restante.

### Capas de protección del QR

1. TTL de 60 segundos (expiración automática)
2. Secreto único por ticket (invalidación ante transferencia)
3. Flag `checked_in` en Redis (anti-replay: no puede entrar dos veces)
4. Verificación del propietario actual en la cadena de bloques

---

## Slide 10a — Redis: Fuente de Verdad del Estado Activo

### Qué decir

> "Redis no es solo un caché. En TicketChain es la base de datos principal del estado activo, con namespaces bien definidos y semántica específica para cada tipo de dato."

### Diseño de namespaces

**Namespace `event:`**

| Key Pattern | Tipo | Propósito |
|---|---|---|
| `event:{eid}` | STRING | Objeto evento completo (JSON): nombre, fecha, reglas, génesis hash |
| `events:list` | LIST | Índice global de event_ids. LPUSH al crear |
| `event:{eid}:available_tickets` | STRING | Contador atómico. DECR al comprar, INCR al cancelar |
| `event:{eid}:listings` | HASH | Tickets en reventa. Field=ticket_id, Value=JSON del listing |
| `event:{eid}:tickets:pool` | LIST | Cola FIFO de IDs de tickets disponibles. LPOP al comprar |

**Namespace `ticket:`**

| Key Pattern | Tipo | Propósito |
|---|---|---|
| `ticket:{eid}:{tid}:owner` | STRING | Dueño actual: `"null"` / `"pending_payment"` / `"0xwallet"` |
| `ticket:{eid}:{tid}:resales` | STRING | Contador de reventas. INCR en cada transferencia |
| `ticket:{eid}:{tid}:qr_secret` | STRING | Secreto hex (32B). Se elimina al transferir |
| `ticket:{eid}:{tid}:checked_in` | STRING | Timestamp de primer ingreso. Ausente = no ingresó |

**Namespace `blockchain:`**

| Key Pattern | Tipo | Propósito |
|---|---|---|
| `blockchain:{event_id}` | LIST | La cadena de bloques del evento. RPUSH al minar |

### Por qué Redis y no PostgreSQL para el estado activo

- **Atomicidad:** `DECR` y `LPOP` son operaciones atómicas → no hay race conditions al comprar tickets en paralelo
- **TTL nativo:** `pending_payment` expira automáticamente en 900s si el pago no se confirma → sin cron jobs
- **Lectura en microsegundos:** el scanner en la puerta verifica `qr_secret` y `checked_in` en <1ms
- **Estructuras de datos:** los listados de reventa como HASH permiten buscar por ticket_id en O(1)

---

## Slide 10b — Redis Master + Réplica + Sentinels

### Qué decir

> "Redis tiene alta disponibilidad con un setup clásico: master-réplica con tres Sentinels. Esto garantiza failover automático sin intervención manual."

### Topología

```
Redis Master (:6379)     ← escrituras y lecturas · AOF habilitado
Redis Réplica (:6380)    ← lecturas · failover target
Sentinel 1 (:26379) ┐
Sentinel 2 (:26380) ├── quorum 2/3 · detectan caída · votan failover
Sentinel 3 (:26381) ┘
```

### Flujo de failover

1. Un Sentinel detecta que el master no responde
2. Aguarda el timeout configurado para evitar falsos positivos
3. Inicia votación entre los 3 Sentinels
4. Si la mayoría (≥2) coincide: el Sentinel líder promueve la réplica a master
5. Notifica a los servicios con la nueva dirección
6. El sistema continúa operando en segundos

### Decisiones de diseño

- **AOF (Append Only File):** cada operación se persiste en disco antes de confirmar. Si el master cae con el disco intacto, no se pierde ninguna transacción
- **3 Sentinels (número impar):** garantiza quorum incluso si uno cae. Con 2 Sentinels, ante la caída de uno queda sin mayoría → no puede declarar failover
- **Los servicios conectan al Sentinel, no al master directamente:** siempre saben a quién conectarse, incluso después de un failover
- **Réplica activa:** sirve lecturas mientras el master vive, distribuyendo carga en operaciones read-heavy como verificación de QRs

---

## Slide 11 — Estructura de la Cadena de Bloques

### Qué decir

> "Cada evento tiene su propia LIST en Redis. El prev_hash de cada bloque apunta al hash del anterior: eso forma la cadena. Si alguien modifica un bloque, invalida todos los que siguen."

### El bloque génesis (Bloque #0)

```json
{
  "index": 0,
  "block_type": "genesis",
  "timestamp": "2026-06-15T10:00:00Z",
  "prev_hash": "0000000000000000",
  "nonce": 0,
  "reglas": {
    "precio_max": "50%",
    "max_reventas": 3,
    "nominada": false,
    "ventana_venta": "24h"
  },
  "transactions": [],
  "block_hash": "000a4f2e···8b1c3d9f"
}
```

- `prev_hash` es ceros: no tiene predecesor
- `nonce = 0`: no requiere minería (el genesis no tiene txs que validar)
- **Las reglas están en el genesis y son inmutables desde aquí**

### Un bloque TX normal

```json
{
  "index": 2,
  "block_type": "tx",
  "event_id": "a1b2c3d4-...",
  "timestamp": "2026-06-16T09:45:33Z",
  "previous_hash": "000b9e3f···d2a7c4b1",
  "nonce": 51823,
  "transactions": [
    { "type": "BUY", "ticket_id": "T000302", "buyer": "0x77dd88ee" },
    { "type": "RESELL", "ticket_id": "T000042", "to": "0x77aa22bb", "price": 18000 }
  ],
  "block_hash": "000c1d5a···e8f3b9c6"
}
```

### La propiedad de cadena

El color del hash de cada bloque coincide con el `prev_hash` del siguiente. Si alguien modifica una transacción en el Bloque #1:
- El hash del Bloque #1 cambia
- El `prev_hash` del Bloque #2 ya no coincide → Bloque #2 inválido
- En cascada: todos los bloques posteriores son inválidos
- Para "arreglarlos" habría que reminar toda la cadena → computacionalmente inviable

---

## Slide 12 — Ciclo de Minería: Proof of Work

### Qué decir

> "El ciclo de minería tiene 5 pasos y cruza dos clusters. El PoW garantiza que modificar la cadena tenga un costo computacional real."

### Los 5 pasos

**Paso 1 — Acumulación (NCT)**  
El Node Coordinator consume de `transactions_q`. Cuando acumula ≥5 transacciones *o* pasan 10 segundos, forma un bloque candidato con el `prev_hash` del último bloque de la cadena.

**Paso 2 — Distribución (NCT → Gateway)**  
Publica en `mining_gateway_q` el bloque candidato con rango total: `nonce_start=0`, `nonce_total=10M`. El Transaction Pool hace PULL cada ~20s con mTLS.

**Paso 3 — División (TrP → Workers)**  
El Transaction Pool subdivide el rango entre los workers disponibles y publica subtareas en `mining_tasks`. Cada worker recibe un rango distinto: no repiten nonces.

**Paso 4 — PoW masivo (Workers)**  
```python
nonce = nonce_start
while nonce < nonce_end:
    data = json.dumps(block) + str(nonce)
    hash = md5(data.encode()).hexdigest()
    if hash.startswith("000"):   # dificultad 3
        publish_result(block)
        return
    nonce += 1
```

**Paso 5 — Validación y persistencia (NCT)**  
El NCT re-verifica el hash localmente → `RPUSH blockchain:{event_id}` en Redis → actualiza owners → ACK. Bloques inválidos: NACK.

### Worker GPU vs Worker CPU

| | Worker GPU | Worker CPU |
|---|---|---|
| Lenguaje | C / CUDA | Python / hashlib |
| Paralelismo | Miles de hilos CUDA simultáneos | Múltiples procesos — `multiprocessing` |
| Implementación | Kernel CUDA + `md5.cuh` custom | `hashlib.md5` |
| Uso | Rangos grandes · máxima velocidad | Complementa GPU o actúa de fallback |

### Por qué el cluster de minería está separado

- Hardware especializado (GPUs) sin afectar latencia de los servicios de usuario
- `MINING_DIFFICULTY=3` es configurable: más ceros = más trabajo computacional → mayor seguridad de la cadena

---

## Slide 13 — Infraestructura Kubernetes

### Qué decir

> "El sistema no solo funciona: está diseñado para observarse, escalarse y recrearse desde cero con un solo comando."

### HPA — Auto-scaling

`transaction-api` y `access-control` tienen `HorizontalPodAutoscaler` configurado.

- **Por qué estos dos:** son los puntos de mayor carga (compras + scanner en puerta)
- **Target CPU: 70%:** permite headroom antes de saturar, trigger de scaling preventivo
- **Demo en vivo:** durante la prueba de carga, el HPA escala pods en tiempo real visible en Grafana

### ingress-nginx + cert-manager

- Instalados vía OpenTofu (Terraform)
- Enruta por path: `/api/*` → microservicios · `/grafana/*` → Grafana
- cert-manager renueva el certificado Let's Encrypt automáticamente → sin expiración manual

### Secrets y ConfigMaps

- **Zero hardcoding:** `JWT_SECRET`, `POSTGRES_PASSWORD`, `MP_ACCESS_TOKEN`, certs mTLS → todos en K8s Secrets
- **Rotación:** cambiar un secret y hacer `rollout restart` en el deployment. Sin rebuild de imagen
- **Principio:** las imágenes son agnósticas al entorno. El entorno se inyecta en runtime

### Prometheus + Grafana

- Stack `kube-prometheus` instalado con Helm
- ServiceMonitors CRD para `transaction-api`, `access-control` y RabbitMQ
- Dashboard "TicketChain — Stress Test" se autocarga desde ConfigMap
- **14 paneles · refresh cada 10s:** RPM, errores 5xx, profundidad de colas, CPU, HPA scaling, reinicios de pods

### Pruebas de carga

Script que simula usuarios comprando y revendiendo en paralelo. Se observa:
- El HPA escalando pods en respuesta a la carga
- La profundidad de las colas RabbitMQ (buffer bajo presión)
- CPU y memoria por pod

### OpenTofu (IaC)

```
tofu apply   # recrea toda la infraestructura desde cero
```

El cluster GKE, node pool, namespaces, ingress-nginx, cert-manager: todo está en código, versionado, reproducible.

---

## Slide 14 — Valor para el Usuario (Cierre)

### Qué decir

> "Todo lo que construimos se traduce en ocho garantías concretas para el usuario. No dependen de que confíen en TicketChain como empresa: están en el código y en la cadena."

### Las 8 garantías

| Garantía | Mecanismo técnico |
|---|---|
| **Transparencia total** | Toda la historia de un ticket es visible en la blockchain. La cadena es pública y auditable |
| **Imposibilidad de doble venta** | QR = JWT 60s + secreto único por ticket + flag anti-replay |
| **Precio máximo de reventa garantizado** | Regla `precio_max` en el génesis (inmutable). El código rechaza listings que la superen |
| **QR dinámico y seguro** | Auto-refresco cada 30s. Captura de pantalla caduca. Secreto destruido al transferir |
| **Validación en puerta** | Scanner en cualquier celular. Respuesta en milisegundos: verde/rojo |
| **Mercado secundario transparente** | Reventa dentro del sistema con precio visible, sin intermediarios opacos |
| **Reglas inmutables desde el día 0** | El organizador define en el génesis. Nadie puede cambiarlas después |
| **Métricas y pruebas de carga** | Grafana con 14 paneles en tiempo real. El sistema se demuestra bajo stress |

### Cierre

> "TicketChain resuelve los tres problemas del mercado con una arquitectura que funciona en producción hoy. La blockchain no es decorativa: es la fuente de verdad que ningún actor puede alterar, incluyendo nosotros mismos."

---

## Preguntas Frecuentes — Preparación

### "¿Por qué MD5 y no SHA-256 para el PoW?"

MD5 es más rápido de calcular que SHA-256, lo que lo hace más manejable para demostraciones académicas y con la GPU disponible. En un sistema productivo real usaríamos SHA-256 o SHA-3 para mayor resistencia a colisiones. La propiedad de dificultad configurable (`"000..."`) aplica igual a cualquier función hash.

### "¿Qué pasa si dos workers encuentran el nonce al mismo tiempo?"

El NCT tiene ACK explícito. El primero que llega es procesado y persiste. El segundo recibe NACK porque el NCT ya validó y commitó el bloque. El sistema es idempotente: solo persiste un bloque por tarea.

### "¿Cómo se garantiza que la CA privada no sea comprometida?"

La CA no está en git. Los certificados se cargan como K8s Secrets con RBAC restringido. En un entorno productivo se usaría un KMS (Key Management Service) o HashiCorp Vault. Para este TP, la gestión manual con `gen-certs.sh` fuera del repositorio es suficiente.

### "¿Por qué Sentinel y no Redis Cluster?"

Redis Cluster distribuye las claves entre nodos (sharding), lo que requiere que los clientes soporten el protocolo de redirección. Sentinel provee failover automático con la misma API de Redis estándar. Para este caso de uso (un solo nodo activo con réplica de backup) Sentinel es más simple y adecuado.

### "¿Por qué no usar una blockchain existente como Ethereum?"

- **Latencia:** Ethereum tiene ~12s por bloque. Nuestra cadena mina en segundos con dificultad configurable
- **Costo:** cada transacción en Ethereum tiene gas fees
- **Control:** las reglas del negocio (precio máximo, max reventas) estarían en un smart contract que requiere auditoría externa
- **Objetivo académico:** el TP exige implementar sistemas distribuidos con PoW propio — usar Ethereum no cumple el pilar computacional (GPU/CUDA)

### "¿Cómo se escala si hay millones de eventos simultáneos?"

La arquitectura de "una cadena por evento" permite escalar horizontalmente: cada evento es una lista Redis independiente, sin bloquear a las demás. El NCT puede paralelizar el procesamiento por evento. El HPA en `transaction-api` maneja picos de compras.

---

## Checklist antes de la demo

- [ ] `https://ticketchain404.duckdns.org` accesible y respondiendo
- [ ] Grafana funcionando con el dashboard cargado
- [ ] Al menos un evento creado con tickets disponibles
- [ ] Worker GPU corriendo (`kubectl get pods -n g-404 -l app=worker-gpu`)
- [ ] Tener listo el test user de MercadoPago: `TESTUSER3260271092483557996`
- [ ] Tener abierta la terminal con `kubectl get hpa -n g-404 -w` para el demo de auto-scaling
- [ ] Cadena de bloques con al menos 3–4 bloques minados para mostrar la estructura

---

*Grupo 404 · UNLu 2026 · Programación Paralela y Sistemas Distribuidos*
