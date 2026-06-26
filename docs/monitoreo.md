# Monitoreo en TicketChain

Este documento explica de forma sencilla qué se levantó para monitorear el sistema y cómo se relacionan todos los componentes.

---

## La idea general

Monitorear significa poder responder preguntas como:
- ¿Cuántas requests por minuto está recibiendo mi API?
- ¿Hay errores 5xx?
- ¿Cuántos mensajes hay acumulados en RabbitMQ?
- ¿Los pods se están reiniciando?
- ¿El HPA escaló?

Para responder eso necesitamos tres cosas: **recolectar datos**, **almacenarlos** y **visualizarlos**.

---

## Recursos de Kubernetes — referencia rápida

Antes de ver cada componente, es útil entender los tipos de recursos que aparecen:

| Tipo de recurso | Qué es |
|---|---|
| **Pod** | La unidad mínima en K8s. Es un contenedor (o grupo de contenedores) corriendo. |
| **Deployment** | Gestiona pods stateless. Si un pod muere, lo recrea. Permite escalar. |
| **StatefulSet** | Como un Deployment pero para apps que necesitan identidad fija y almacenamiento persistente (ej: bases de datos). |
| **DaemonSet** | Corre **un pod por cada nodo** del clúster. Se usa para agentes de sistema. |
| **ConfigMap** | Almacena configuración en clave-valor. No corre nada, solo guarda datos. |
| **Secret** | Como ConfigMap pero para datos sensibles (contraseñas, tokens). |
| **Service** | Expone un pod o grupo de pods con una IP estable dentro del clúster. |
| **Ingress** | Regla de routing HTTP/HTTPS hacia afuera del clúster (como un proxy reverso). |
| **PersistentVolumeClaim (PVC)** | Solicitud de almacenamiento en disco persistente. |
| **CRD (Custom Resource Definition)** | Extiende K8s con tipos nuevos inventados por terceros (ej: `ServiceMonitor`). |

---

## Los componentes

### Prometheus — el recolector

> **Recurso K8s:** `StatefulSet` (1 pod) + `PersistentVolumeClaim` de 5 GB + `Service` para exponer su API interna

Prometheus es una base de datos de series temporales especializada en métricas. Su trabajo es simple: cada cierto tiempo va a buscar métricas a los servicios y las guarda.

Usa un `StatefulSet` (y no un `Deployment`) porque necesita disco persistente — si el pod se reinicia, los datos históricos no se pueden perder.

```
Prometheus → "che, transaction-api, dame tus métricas"
transaction-api → devuelve números en texto plano (formato Prometheus)
Prometheus → guarda esos números con timestamp
```

El formato que exponen los servicios es así:

```
http_requests_total{route="/api/v1/tickets", status_code="200"} 1432
http_requests_total{route="/api/v1/tickets", status_code="500"} 3
```

Cada línea es una **métrica** con **labels** (etiquetas) que permiten filtrar.

En TicketChain, Prometheus se configuró con:
- **Retención de 7 días** — guarda datos de la última semana
- **5 GB de almacenamiento persistente** en Kubernetes
- Capacidad de descubrir servicios en **cualquier namespace** (no solo el propio)

---

### Grafana — el visualizador

> **Recurso K8s:** `Deployment` (1 pod) + `Service` + `Ingress` para acceso externo vía HTTPS

Grafana no recolecta nada. Solo sabe leer datos de Prometheus y mostrarlos como gráficos.

Usa un `Deployment` (y no un `StatefulSet`) porque es stateless — su estado (dashboards, usuarios) lo guarda en una base de datos SQLite o externa, no en el pod en sí.

```
Grafana → "Prometheus, dame http_requests_total de los últimos 30 minutos"
Prometheus → devuelve los datos
Grafana → dibuja el gráfico en pantalla
```

En TicketChain está disponible en:
```
https://ticketchain404.duckdns.org/grafana
```

---

### Prometheus Operator — el director de orquesta

> **Recurso K8s:** `Deployment` (1 pod)

Este es un componente que viene incluido en el Helm chart y es clave para entender cómo funciona todo. El Operator es el que:

1. Registra los tipos de recursos custom (`ServiceMonitor`, `Prometheus`, etc.) en el clúster mediante **CRDs**
2. "Vigila" cuando se crea o modifica un `ServiceMonitor`
3. Actualiza automáticamente la configuración de Prometheus para que scrapee el nuevo servicio

Sin el Operator, los `ServiceMonitor` son solo archivos YAML sin efecto.

---

### ServiceMonitor — el "mapa" de qué scrapear

> **Recurso K8s:** `ServiceMonitor` — un **CRD** (tipo custom creado por el Prometheus Operator), `apiVersion: monitoring.coreos.com/v1`

Prometheus necesita saber **a qué servicios ir a buscar métricas**. Eso se le indica con un `ServiceMonitor`.

No es un pod ni corre nada. Es pura configuración declarativa que el Operator lee y traduce a reglas de scraping internas de Prometheus.

Es básicamente una configuración que dice:

> "Prometheus: cada 15 segundos, andá al servicio que tenga el label `app: transaction-api` en el namespace `g-404` y pedile métricas en la ruta `/metrics`."

Se levantaron tres ServiceMonitors:

| ServiceMonitor | Tipo de recurso | Servicio que monitorea | Puerto | Ruta |
|---|---|---|---|---|
| `transaction-api` | CRD `ServiceMonitor` | API de transacciones | `http` | `/metrics` |
| `access-control` | CRD `ServiceMonitor` | API de control de acceso | `http` | `/metrics` |
| `rabbitmq` | CRD `ServiceMonitor` | Broker de mensajería | `prometheus` | `/metrics` y `/metrics/detailed` |

RabbitMQ tiene dos endpoints porque `/metrics/detailed` con el parámetro `queue_coarse_metrics` da info más granular por cola.

---

### kube-state-metrics — métricas del clúster

> **Recurso K8s:** `Deployment` (1 pod) + `Service`

Este componente viene incluido en el stack y expone métricas sobre los **objetos de Kubernetes** en sí mismos:

- Cuántas réplicas tiene un Deployment
- Estado de los pods (running, pending, crashloopbackoff)
- Réplicas actuales y máximas del HPA

Habla con la API de Kubernetes (no con los pods directamente) y traduce ese estado a métricas que Prometheus puede scrapear.

Sin este componente no podríamos ver en Grafana si el HPA escaló o si un pod se reinició.

---

### node-exporter — métricas del nodo físico

> **Recurso K8s:** `DaemonSet` — corre **un pod por cada nodo** del clúster

También viene incluido. Como necesita acceder al hardware del nodo (CPU, RAM, disco), debe correr en todos los nodos, de ahí el `DaemonSet`.

Expone métricas del sistema operativo:
- Uso de CPU del nodo
- Memoria RAM disponible
- Disco y red

---

### Dashboard (ticketchain-dashboard.yaml) — la configuración visual

> **Recurso K8s:** `ConfigMap`

No es un pod ni corre nada. Es un `ConfigMap` que contiene el JSON de definición del dashboard de Grafana.

Grafana tiene un sidecar (contenedor secundario en el mismo pod) que vigila los `ConfigMap` con el label `grafana_dashboard: "1"` y los importa automáticamente al arrancar. Así no hay que entrar a la UI de Grafana a importar dashboards a mano.

---

### prometheus-values.yaml — la configuración del Helm chart

> **No es un recurso K8s** — es el archivo de valores que se le pasa a Helm al instalar

Este archivo no se aplica con `kubectl`. Es la "receta" que se le da a Helm para personalizar la instalación del chart `kube-prometheus-stack`. Define cosas como retención, storage, contraseña de Grafana e Ingress.

---

## Cómo se relacionan

```
┌─────────────────────────────────────────────────────┐
│                   Kubernetes (g-404)                │
│                                                     │
│  ┌──────────────┐    ┌──────────────┐               │
│  │transaction-api│   │access-control│               │
│  │  /metrics    │   │  /metrics    │               │
│  └──────┬───────┘   └──────┬───────┘               │
│         │                  │                        │
│  ┌──────┴──────────────────┴──────┐                │
│  │           RabbitMQ             │                │
│  │  /metrics  +  /metrics/detailed│                │
│  └──────────────┬─────────────────┘                │
└─────────────────┼───────────────────────────────────┘
                  │  ServiceMonitors le dicen
                  │  a Prometheus qué scrapear
                  ▼
┌─────────────────────────────────────────────────────┐
│              namespace: monitoring                  │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │              Prometheus                     │   │
│  │  - Scrapea cada 15s según ServiceMonitors   │   │
│  │  - Guarda series temporales (7 días, 5GB)   │   │
│  │  - También scrapea kube-state-metrics       │   │
│  │    y node-exporter automáticamente          │   │
│  └──────────────────────┬──────────────────────┘   │
│                         │                          │
│  ┌──────────────────────▼──────────────────────┐   │
│  │              Grafana                        │   │
│  │  - Lee datos de Prometheus con PromQL       │   │
│  │  - Muestra dashboards en /grafana           │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## El dashboard de TicketChain

Se creó un dashboard personalizado llamado **"TicketChain — Stress Test"** (definido como un `ConfigMap` con el JSON del dashboard). Grafana lo importa automáticamente gracias al label `grafana_dashboard: "1"`.

El dashboard tiene estas secciones:

### Tráfico HTTP
- **RPM de transaction-api** — requests por minuto por ruta
- **RPM de access-control** — ídem para la otra API
- **Errores 5xx por minuto** — alertas visuales cuando algo falla
- **Requests por status code** — distribución de respuestas (200, 400, 500, etc.)

### RabbitMQ — Colas
- **transactions_q** — mensajes totales, listos y sin confirmar (unacked)
- **mining_gateway_q** — profundidad de la cola de minado
- **nct_results_q** — resultados del proceso NCT (Non-Cryptographic Tokens)
- **Operaciones por cola/seg** — throughput de procesamiento

### CPU & Memoria
- CPU en millicores por container/pod
- Memoria (working set) por container/pod

### Escalabilidad & Salud
- **HPA réplicas activas vs máximo** — muestra si el autoscaler escaló
- **Reinicios de pods en los últimos 30m** — detecta crashloops
- **Estado de pods en g-404** — semáforo verde/rojo por deployment

---

## PromQL — el lenguaje de consulta

Las queries que usa el dashboard son en **PromQL**, el lenguaje de Prometheus. Algunos ejemplos del dashboard:

```promql
# Requests por minuto de transaction-api (excluyendo el endpoint /metrics)
sum(rate(http_requests_total{job="transaction-api", route!="/metrics"}[1m])) * 60

# Errores 5xx por minuto
sum(rate(http_requests_total{job="transaction-api", status_code=~"5.."}[1m])) * 60

# Réplicas actuales del HPA
kube_horizontalpodautoscaler_status_current_replicas{namespace="g-404"}

# Profundidad de la cola de transactions_q
rabbitmq_detailed_queue_messages{queue="transactions_q"}
```

La función `rate()` calcula la tasa de cambio por segundo de un contador. Multiplicar por 60 convierte a "por minuto".

---

## Cómo se instaló todo

Se usó el **Helm chart `kube-prometheus-stack`** que instala en un solo comando:
- Prometheus
- Grafana
- kube-state-metrics
- node-exporter
- El operador de Prometheus (que entiende los `ServiceMonitor`)

Los ServiceMonitors y el dashboard se aplicaron aparte con `kubectl apply`.
