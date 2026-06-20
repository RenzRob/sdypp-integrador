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
for svc in worker-cpu worker-gpu transaction-api transaction-pool event-registry status-api access-control auth-service nct; do
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

## Kubernetes (k8s)

Kubeconfig: `renzo.yaml` (raíz del proyecto)
Namespace: `g-404`

### Aplicar todo el cluster (en orden)

```bash
kubectl apply -f iac/k8s/config/
kubectl apply -f iac/k8s/deployments/infrastructure/
kubectl apply -f iac/k8s/deployments/services/
kubectl apply -f iac/k8s/network/
```

### Crear secrets

```bash
kubectl create secret generic ticketchain-secrets \
  --from-literal=JWT_SECRET=<valor> \
  --from-literal=POSTGRES_USER=<valor> \
  --from-literal=POSTGRES_PASSWORD=<valor> \
  --from-literal=MINIO_ACCESS_KEY=<valor> \
  --from-literal=MINIO_SECRET_KEY=<valor> \
  -n g-404

kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=RenzRob \
  --docker-password=<TOKEN> \
  -n g-404
```

### Comandos útiles

```bash
# Ver pods
kubectl get pods -n g-404

# Ver logs de un servicio
kubectl logs -f deployment/event-registry -n g-404

# Ver secrets (sin valores)
kubectl get secrets -n g-404

# Reiniciar un deployment (para que tome nuevos secrets/configmap)
kubectl rollout restart deployment/event-registry -n g-404

# Ver estado de todos los deployments
kubectl get deployments -n g-404

# Eliminar todos los recursos del namespace
kubectl delete all --all -n g-404
```
