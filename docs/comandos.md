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

docker build --platform linux/amd64 -t ghcr.io/renzrob/nginx:latest iac/nginx/
docker push ghcr.io/renzrob/nginx:latest
```

### Ver imágenes locales

```bash
docker images | grep ghcr.io/renzrob
```

> **Nota zsh:** usar siempre `"ghcr.io/renzrob/${svc}:latest"` con llaves y comillas.
> Sin llaves, zsh interpreta `:l` como modificador lowercase y corrompe el tag.

---

## Kubernetes (arquitectura de 2 clusters)

Los manifests están separados por cluster en `iac/k8s/`:

```
cluster-services/   → cluster propio (GKE): app, NCT, redis, rabbitmq, mining-gateway
cluster-mining/    → cluster del profe (g-404): TrP + workers + rabbitmq local (con GPU)
```

El tráfico entre clusters va SOLO por HTTPS con **mTLS** (mining-gateway ↔ TrP).
Ningún RabbitMQ se expone.

### Certificados mTLS entre clusters

```bash
# 1) Generar CA + certs (usar los dominios reales de cada endpoint)
GATEWAY_HOST=gateway.midominio.com TRP_HOST=trp.midominio.com \
  iac/k8s/certs/gen-certs.sh
# Los certs quedan en iac/k8s/certs/out/ (gitignored — NO se commitean)

# 2) Crear secrets en el CLUSTER PROPIO (mining-gateway)
kubectl create secret tls gateway-tls \
  --cert=iac/k8s/certs/out/gateway.crt --key=iac/k8s/certs/out/gateway.key -n <ns-propio>
kubectl create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt -n <ns-propio>

# 3) Crear secrets en el CLUSTER DEL PROFE (transaction-pool)
kubectl --kubeconfig=renzo.yaml create secret tls trp-tls \
  --cert=iac/k8s/certs/out/trp.crt --key=iac/k8s/certs/out/trp.key -n g-404
kubectl --kubeconfig=renzo.yaml create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt -n g-404
```

Cada servicio usa su `*-tls` como server (en el Ingress) y como client (al llamar
al otro). El Ingress verifica el cert de cliente contra `cross-cluster-ca`
(annotations `auth-tls-*`). El `#1` (frontend público) usa HTTPS común, no mTLS.

### Antes de aplicar: completar placeholders

- `cluster-services/config/configmap.yaml` → `TRP_URL` (URL pública HTTPS del TrP)
- `cluster-mining/config/configmap.yaml` → `GATEWAY_URL` (URL pública HTTPS del gateway)
- `*/network/*-ingress.yaml` → host real + Secret TLS

### Aplicar cluster propio (GKE)

```bash
kubectl apply -f iac/k8s/cluster-services/config/
kubectl apply -f iac/k8s/cluster-services/infrastructure/
kubectl apply -f iac/k8s/cluster-services/services/
kubectl apply -f iac/k8s/cluster-services/network/
```

### Aplicar cluster del profe (g-404)

```bash
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/infrastructure/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/config/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/services/
kubectl --kubeconfig=renzo.yaml apply -f iac/k8s/cluster-mining/network/
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
  -n <namespace-propio>

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io --docker-username=RenzRob \
  --docker-password=<TOKEN> -n <namespace>
```

### Comandos útiles

```bash
# Pods del cluster del profe
kubectl --kubeconfig=renzo.yaml get pods -n g-404

# Logs del TrP / gateway
kubectl --kubeconfig=renzo.yaml logs -f deployment/transaction-pool -n g-404
kubectl logs -f deployment/mining-gateway -n <namespace-propio>

# Reiniciar para tomar configmap/secret nuevos
kubectl --kubeconfig=renzo.yaml rollout restart deployment/transaction-pool -n g-404
```
