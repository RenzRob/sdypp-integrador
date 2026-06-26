# Comandos TicketChain

---

## Local (Docker Compose)

```bash
# Levantar todo (build + start)
./iac/local/run_local.sh

# Levantar sin rebuilding (más rápido si no cambió código)
./iac/local/run_local.sh --no-build

# Ver logs en tiempo real
./iac/local/run_local.sh --logs

# Detener contenedores
./iac/local/run_local.sh --down

# Detener y borrar volúmenes (se pierde Redis, Postgres, MinIO)
./iac/local/run_local.sh --down-volumes

# Arrancar desde cero (borra volúmenes y levanta)
./iac/local/run_local.sh --from-scratch
```

Puntos de acceso local:
- App: http://localhost
- RabbitMQ console: http://localhost:15672 (guest / guest)
- MinIO console: http://localhost:9001 (minioadmin / minioadmin)

---

## Imágenes Docker (ghcr.io)

Registry: `ghcr.io/renzrob/`

### Login

```bash
echo <TOKEN> | docker login ghcr.io -u RenzRob --password-stdin
```

### Build y push de un servicio individual

```bash
docker build --platform linux/amd64 \
    -t ghcr.io/renzrob/<servicio>:latest \
    backend/<servicio>/

docker push ghcr.io/renzrob/<servicio>:latest
```

### Build y push de todos los servicios backend

```bash
for svc in worker-cpu worker-gpu transaction-api transaction-pool mining-gateway event-registry status-api access-control auth-service nct; do
    docker build --platform linux/amd64 \
        -t "ghcr.io/renzrob/${svc}:latest" \
        "backend/${svc}/"
    docker push "ghcr.io/renzrob/${svc}:latest"
done
```

### Build y push de frontend y nginx

```bash
docker build --platform linux/amd64 -t ghcr.io/renzrob/frontend:latest frontend/
docker push ghcr.io/renzrob/frontend:latest

docker build --platform linux/amd64 -t ghcr.io/renzrob/nginx:latest iac/local/nginx/
docker push ghcr.io/renzrob/nginx:latest
```

### Ver imágenes locales

```bash
docker images | grep ghcr.io/renzrob
```

> **Nota zsh:** usar siempre `"ghcr.io/renzrob/${svc}:latest"` con llaves y comillas.
> Sin llaves, zsh interpreta `:l` como modificador lowercase y corrompe el tag.

---

## Despliegue cluster propio (GKE)

Flujo completo desde cero. Los pasos 1 y 2 son con OpenTofu; el 3 en adelante con kubectl.

### Paso 1 — Autenticarse con GCP

```bash
gcloud auth application-default login
```

### Paso 2 — Provisionar infra con OpenTofu

Crea el cluster GKE, el node pool, instala ingress-nginx y cert-manager.

```bash
cd iac/tofu/cluster-services
tofu init       # solo la primera vez
tofu plan       # ver qué va a crear/cambiar
tofu apply      # aplicar
cd ../..
```

Obtener credenciales del cluster recién creado:

```bash
gcloud container clusters get-credentials app-cluster \
  --region us-central1 --project proyecto-sobel-grupo404
```

> Para destruir todo el cluster: `tofu destroy` (desde `iac/tofu/cluster-services/`)

### Paso 3 — Crear secrets (cluster propio)

```bash
kubectl create secret generic ticketchain-secrets \
  --from-literal=JWT_SECRET=<valor> \
  --from-literal=POSTGRES_USER=<valor> \
  --from-literal=POSTGRES_PASSWORD=<valor> \
  --from-literal=MINIO_ACCESS_KEY=<valor> \
  --from-literal=MINIO_SECRET_KEY=<valor> \
  --from-literal=ADMIN_EMAIL=<email> \
  --from-literal=ADMIN_PASSWORD=<password> \
  --from-literal=SCANNER_EMAIL=<email> \
  --from-literal=SCANNER_PASSWORD=<password> \
  --from-literal=LOAD_TEST_EMAIL=<email> \
  --from-literal=LOAD_TEST_PASSWORD=<password> \
  --from-literal=MP_ACCESS_TOKEN=<token TEST- o produccion de MP> \
  --from-literal=MP_WEBHOOK_SECRET=<secreto webhook MP> \
  --from-literal=PUBLIC_API_URL=https://ticketchain404.duckdns.org \
  -n g-404

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=RenzRob \
  --docker-password=<TOKEN> -n g-404
```

### Paso 4 — Certificados mTLS (cross-cluster)

```bash
# Generar CA + certs. El SAN del cert del gateway = host público del gateway.
GATEWAY_HOST=gateway.34.61.108.95.nip.io iac/k8s/certs/gen-certs.sh
# Los certs quedan en iac/k8s/certs/out/ (gitignored — NO se commitean)

# GKE: cert de servidor del ingress + CA para verificar al TrP
kubectl create secret tls gateway-tls \
  --cert=iac/k8s/certs/out/gateway.crt --key=iac/k8s/certs/out/gateway.key -n g-404
kubectl create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt -n g-404

# g-404: cert de cliente del TrP + CA para verificar al gateway
kubectl --kubeconfig=renzo.yaml create secret tls trp-tls \
  --cert=iac/k8s/certs/out/trp.crt --key=iac/k8s/certs/out/trp.key -n g-404
kubectl --kubeconfig=renzo.yaml create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt -n g-404
```

### Paso 5 — Aplicar manifiestos k8s (cluster propio)

Los microservicios, infraestructura de la app e ingress se gestionan con kubectl (no con tofu).

```bash
kubectl apply -f iac/k8s/cluster-services/config/
kubectl apply -f iac/k8s/cluster-services/infrastructure/
kubectl apply -f iac/k8s/cluster-services/services/
kubectl apply -f iac/k8s/cluster-services/network/
```

---

## Kubernetes (arquitectura de 2 clusters)

Los manifests están separados por cluster en `iac/k8s/`:

```
cluster-services/   → cluster propio (GKE): app, NCT, redis, rabbitmq, mining-gateway
cluster-mining/    → cluster del profe (g-404): TrP + workers + rabbitmq local (con GPU)
```

**Modelo PULL:** g-404 no expone nada. El TrP hace solo llamadas SALIENTES al
mining-gateway (pide tarea con `GET /next-task`, postea resultado con `POST /result`).
El único endpoint público es el mining-gateway en GKE, detrás de ingress-nginx con
**mTLS**. Ningún RabbitMQ se expone.

```
NCT → queue:mining → mining-gateway ← GET /next-task ← TrP → workers
                     mining-gateway ← POST /result   ← TrP
mining-gateway → queue:nct_results → NCT
```

### Aplicar cluster del profe (g-404)

```bash
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/infrastructure/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/config/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/services/
```

### Aplicar cluster del profe (g-404)

```bash
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/infrastructure/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/config/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/services/
```

> El `nvidia-device-plugin.yaml` requiere cluster-admin → lo aplica el profe.

### Otros secrets (cluster propio)

```bash
kubectl create secret generic ticketchain-secrets \
  --from-literal=JWT_SECRET=<valor> \
  --from-literal=POSTGRES_USER=<valor> \
  --from-literal=POSTGRES_PASSWORD=<valor> \
  --from-literal=MINIO_ACCESS_KEY=<valor> \
  --from-literal=MINIO_SECRET_KEY=<valor> \
  --from-literal=ADMIN_EMAIL=<email> \
  --from-literal=ADMIN_PASSWORD=<password> \
  --from-literal=SCANNER_EMAIL=<email> \
  --from-literal=SCANNER_PASSWORD=<password> \
  --from-literal=LOAD_TEST_EMAIL=<email> \
  --from-literal=LOAD_TEST_PASSWORD=<password> \
  --from-literal=MP_ACCESS_TOKEN=<token TEST- o produccion de MP> \
  --from-literal=MP_WEBHOOK_SECRET=<secreto webhook MP> \
  --from-literal=PUBLIC_API_URL=https://ticketchain404.duckdns.org \
  -n g-404

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=RenzRob \
  --docker-password=<TOKEN> -n g-404
```

### Comandos útiles

```bash
# Pods del cluster del profe
kubectl --kubeconfig=renzo.yaml get pods -n g-404

# Logs del TrP / gateway
kubectl --kubeconfig=renzo.yaml logs -f deployment/transaction-pool -n g-404
kubectl logs -f deployment/mining-gateway -n g-404

# Reiniciar para tomar configmap/secret nuevos
kubectl --kubeconfig=renzo.yaml rollout restart deployment/transaction-pool -n g-404
```

### HPA (Horizontal Pod Autoscaler)

```bash
# Ver estado de todos los HPAs (CPU actual vs target, réplicas)
kubectl get hpa -n g-404

# Watch en tiempo real (útil durante pruebas de carga)
kubectl get hpa -n g-404 -w

# Detalle de un HPA específico (eventos de scaling, métricas)
kubectl describe hpa transaction-api-hpa -n g-404
kubectl describe hpa access-control-hpa -n g-404
```

---

## Monitoreo (Prometheus + Grafana)

Stack: **kube-prometheus-stack** (Helm) en namespace `monitoring`.
Componentes activos: Prometheus, Grafana, kube-state-metrics, node-exporter.
AlertManager: deshabilitado (reduce recursos).

### Instalación

```bash
# Agregar repositorio
helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
helm repo update

# Instalar / actualizar con los values del repo
helm upgrade --install monitoring prometheus-community/kube-prometheus-stack \
  -n monitoring --create-namespace \
  -f iac/k8s/cluster-services/monitoring/prometheus-values.yaml
```

### Aplicar ServiceMonitors y dashboard

Los ServiceMonitors le indican a Prometheus qué pods raspar. El dashboard se carga automáticamente como ConfigMap con label `grafana_dashboard: "1"`.

```bash
# ServiceMonitors (un archivo por servicio)
kubectl apply -f iac/k8s/cluster-services/monitoring/transaction-api-servicemonitor.yaml
kubectl apply -f iac/k8s/cluster-services/monitoring/access-control-servicemonitor.yaml
kubectl apply -f iac/k8s/cluster-services/monitoring/rabbitmq-servicemonitor.yaml

# Dashboard Grafana (ConfigMap auto-cargado)
kubectl apply -f iac/k8s/cluster-services/monitoring/ticketchain-dashboard.yaml
```

### Acceso a Grafana

| Modo | URL |
|---|---|
| Ingress público | https://ticketchain404.duckdns.org/grafana/ |
| Port-forward local | `kubectl port-forward svc/monitoring-grafana 3000:80 -n monitoring` → http://localhost:3000 |

- **Usuario:** `admin`
- **Dashboard:** `TicketChain — Stress Test` (uid: `ticketchain-stress`)

### Acceso a Prometheus (diagnóstico)

```bash
# Port-forward — útil para explorar targets y ejecutar PromQL
kubectl port-forward svc/monitoring-kube-prometheus-prometheus 9090:9090 -n monitoring
# → http://localhost:9090/targets   (ver estado de scraping)
# → http://localhost:9090/graph     (ejecutar PromQL)
```

### Diagnóstico de scraping

```bash
# Ver todos los ServiceMonitors registrados
kubectl get servicemonitor -n monitoring

# Verificar que Prometheus cargó los targets (requiere port-forward al :9090)
# http://localhost:9090/targets → buscar "transaction-api", "access-control", "rabbitmq"

# Ver logs de Prometheus
kubectl logs -n monitoring -l app.kubernetes.io/name=prometheus -c prometheus --tail=50

# Ver logs de Grafana
kubectl logs -n monitoring -l app.kubernetes.io/name=grafana --tail=50

# Verificar que el dashboard fue cargado
kubectl get configmap -n monitoring -l grafana_dashboard=1
```

### PromQL útiles

```promql
# Requests por minuto en transaction-api (por ruta)
sum by (route) (rate(http_requests_total{job="transaction-api",route!="/metrics"}[1m])) * 60

# Errores 5xx en ambas APIs
sum(rate(http_requests_total{job=~"transaction-api|access-control",status_code=~"5.."}[1m])) * 60

# Profundidad de la cola transactions_q
rabbitmq_detailed_queue_messages{queue="transactions_q"}

# CPU de transaction-api en millicores
rate(container_cpu_usage_seconds_total{namespace="g-404",container="transaction-api"}[2m]) * 1000

# Memoria working-set de access-control
container_memory_working_set_bytes{namespace="g-404",container="access-control"}

# Réplicas actuales vs máximas (HPA)
kube_horizontalpodautoscaler_status_current_replicas{namespace="g-404"}
kube_horizontalpodautoscaler_spec_max_replicas{namespace="g-404"}

# Reinicios de pods en los últimos 30 min
increase(kube_pod_container_status_restarts_total{namespace="g-404"}[30m])
```

### Desinstalar el stack de monitoreo

```bash
helm uninstall monitoring -n monitoring
kubectl delete ns monitoring
```
