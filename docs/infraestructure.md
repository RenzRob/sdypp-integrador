# Infraestructura TicketChain

## Estructura de directorios

```
iac/
├── local/                         — desarrollo local (Docker Compose)
│   ├── docker-compose.yml
│   ├── run_local.sh
│   └── .env                       ← commiteado, valores de desarrollo
├── k8s/
│   ├── cluster-services/          — cluster GKE propio (Grupo 404)
│   │   ├── config/                — namespace, configmap
│   │   ├── infrastructure/        — postgres, redis, rabbitmq, minio
│   │   ├── services/              — microservicios de aplicación + mining-gateway
│   │   ├── network/               — ingress (HTTPS público + mTLS para mining-gateway)
│   │   └── monitoring/            — stack de observabilidad (Prometheus + Grafana)
│   │       ├── prometheus-values.yaml           — Helm values del kube-prometheus-stack
│   │       ├── transaction-api-servicemonitor.yaml  — scraping de transaction-api:3003/metrics
│   │       ├── access-control-servicemonitor.yaml   — scraping de access-control:3004/metrics
│   │       ├── rabbitmq-servicemonitor.yaml         — scraping de rabbitmq:15692/metrics
│   │       └── ticketchain-dashboard.yaml           — ConfigMap con dashboard Grafana
│   └── cluster-mining/            — cluster del profe (g-404)
│       ├── config/                — configmap
│       ├── infrastructure/        — rabbitmq local, nvidia-device-plugin
│       └── services/              — transaction-pool, worker-cpu, worker-gpu
└── nginx/                         — configuración de nginx (local y k8s)
```

> Ver `docs/comandos.md` para todos los comandos de despliegue, gestión de secrets y mTLS.

---

## Componentes de cluster (instalación única)

### ingress-nginx

Recibe el tráfico público y aplica las reglas definidas en `network/ingress.yaml` y `network/api-ingress.yaml`. Los manifiestos usan `ingressClassName: nginx` para apuntar a este controller.

```bash
kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.15.1/deploy/static/provider/cloud/deploy.yaml
kubectl wait --namespace ingress-nginx \
  --for=condition=ready pod \
  --selector=app.kubernetes.io/component=controller \
  --timeout=120s
```

---

## Aplicar al cluster propio (GKE — cluster-services)

```bash
kubectl apply -f iac/k8s/cluster-services/config/
kubectl apply -f iac/k8s/cluster-services/infrastructure/
kubectl apply -f iac/k8s/cluster-services/services/
kubectl apply -f iac/k8s/cluster-services/network/
```

## Aplicar al cluster del profe (g-404 — cluster-mining)

```bash
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/infrastructure/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/config/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/services/
```

> El `nvidia-device-plugin.yaml` requiere cluster-admin — lo aplica el profe.

---

## Secrets

Los secrets **nunca se commitean** con valores reales.

### Cluster propio (cluster-services)

```bash
kubectl create secret generic ticketchain-secrets \
  --from-literal=JWT_SECRET=<string largo y aleatorio> \
  --from-literal=POSTGRES_USER=<usuario> \
  --from-literal=POSTGRES_PASSWORD=<password> \
  --from-literal=MINIO_ACCESS_KEY=<access key> \
  --from-literal=MINIO_SECRET_KEY=<secret key> \
  --from-literal=MP_ACCESS_TOKEN=<token TEST- o produccion de MP> \
  --from-literal=MP_WEBHOOK_SECRET=<secreto webhook MP> \
  --from-literal=PUBLIC_API_URL=https://ticketchain404.duckdns.org \
  -n g-404

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=RenzRob \
  --docker-password=<TOKEN> -n g-404
```

### Certificados mTLS (cross-cluster)

Los certs se generan una vez con `iac/k8s/certs/gen-certs.sh` y se cargan como secrets en ambos clusters. Ver `docs/comandos.md` — sección "Certificados mTLS" para el procedimiento completo.

| Secret | Cluster | Contenido |
|---|---|---|
| `gateway-tls` | cluster-services | Cert de servidor del ingress (CN = host público del gateway) |
| `cross-cluster-ca` | cluster-services | CA para verificar el cert de cliente del TrP |
| `trp-tls` | cluster-mining | Cert de cliente del TrP |
| `cross-cluster-ca` | cluster-mining | CA para verificar el cert del gateway |

### Verificar secrets

```bash
kubectl get secrets -n g-404
kubectl --kubeconfig=renzo.yaml get secrets -n g-404
```

---

## Monitoreo

### Stack

| Componente | Helm chart | Namespace |
|---|---|---|
| Prometheus | kube-prometheus-stack | monitoring |
| Grafana | kube-prometheus-stack | monitoring |
| kube-state-metrics | kube-prometheus-stack | monitoring |
| node-exporter | kube-prometheus-stack | monitoring |
| AlertManager | **deshabilitado** | — |

### Targets de scraping (ServiceMonitors)

| Target | Servicio | Puerto | Path | Intervalo |
|---|---|---|---|---|
| transaction-api | `transaction-api` (ns: g-404) | 3003 | `/metrics` | 15 s |
| access-control | `access-control` (ns: g-404) | 3004 | `/metrics` | 15 s |
| rabbitmq | `rabbitmq` (ns: g-404) | 15692 | `/metrics` | 15 s |
| rabbitmq-detailed | `rabbitmq` (ns: g-404) | 15692 | `/metrics/detailed?family=queue_coarse_metrics` | 15 s |

### Métricas expuestas por la aplicación

**transaction-api y access-control** (Node.js + prom-client):
- `http_requests_total{method, route, status_code}` — contador de requests HTTP
- Métricas de runtime Node.js: CPU, heap, GC, event-loop lag

**RabbitMQ** (exporter built-in):
- `rabbitmq_detailed_queue_messages{queue}` — mensajes totales en cola
- `rabbitmq_detailed_queue_messages_ready{queue}` — mensajes listos
- `rabbitmq_detailed_queue_messages_unacked{queue}` — mensajes sin ACK
- `rabbitmq_detailed_queue_process_reductions_total{queue}` — throughput de cola

**Kubernetes** (kube-state-metrics + kubelet):
- `container_cpu_usage_seconds_total` — CPU por contenedor
- `container_memory_working_set_bytes` — memoria por contenedor
- `kube_horizontalpodautoscaler_status_current_replicas` — réplicas HPA
- `kube_pod_container_status_restarts_total` — reinicios de pods

### Dashboard Grafana

- **Nombre:** TicketChain — Stress Test (uid: `ticketchain-stress`)
- **Refresh:** 10 segundos
- **Carga:** automática via ConfigMap con label `grafana_dashboard: "1"`
- **URL:** https://ticketchain404.duckdns.org/grafana/

Paneles disponibles:

| Sección | Panel | Métrica principal |
|---|---|---|
| Tráfico HTTP | RPM transaction-api | `rate(http_requests_total{job="transaction-api"}[1m])` |
| Tráfico HTTP | RPM access-control | `rate(http_requests_total{job="access-control"}[1m])` |
| Errores HTTP | Errores 5xx/min | `http_requests_total{status_code=~"5.."}` |
| Errores HTTP | Distribución por status code | `http_requests_total` agrupado por `status_code` |
| RabbitMQ Colas | Profundidad transactions_q | `rabbitmq_detailed_queue_messages{queue="transactions_q"}` |
| RabbitMQ Colas | Profundidad mining_gateway_q | `rabbitmq_detailed_queue_messages{queue="mining_gateway_q"}` |
| RabbitMQ Colas | Profundidad nct_results_q | `rabbitmq_detailed_queue_messages{queue="nct_results_q"}` |
| Throughput colas | Ops/seg | `rate(rabbitmq_detailed_queue_process_reductions_total[1m])` |
| CPU & Memoria | CPU millicores | `container_cpu_usage_seconds_total` |
| CPU & Memoria | Memoria working-set | `container_memory_working_set_bytes` |
| Escalabilidad | HPA réplicas actuales vs máx | `kube_horizontalpodautoscaler_*` |
| Escalabilidad | Pod restarts (30 min) | `kube_pod_container_status_restarts_total` |
| Escalabilidad | Estado deployments | `kube_deployment_status_replicas_available` |

### Prometheus — configuración relevante

- **Retención:** 7 días
- **Storage:** PVC 5 Gi (`standard-rwo`)
- **ServiceMonitor discovery:** todos los namespaces (`serviceMonitorNamespaceSelector: {}`)
- **Ingress Grafana:** HTTPS con cert-manager (Let's Encrypt), secret `grafana-tls`

Ver `docs/comandos.md` — sección "Monitoreo" para todos los comandos de instalación y diagnóstico.
