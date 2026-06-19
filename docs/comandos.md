# Comandos TicketChain

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

## Kubernetes (GKE)

### Aplicar todo el cluster (en orden)

```bash
kubectl apply -f iac/k8s/config/
kubectl apply -f iac/k8s/deployments/infrastructure/
kubectl apply -f iac/k8s/deployments/services/
kubectl apply -f iac/k8s/network/
```

### Comandos útiles

```bash
# Ver pods
kubectl get pods -n ticketchain

# Ver logs de un servicio
kubectl logs -f deployment/event-registry -n ticketchain

# Ver secrets (sin valores)
kubectl get secrets -n ticketchain

# Crear secrets manualmente (en lugar de aplicar secrets.yaml con valores reales)
kubectl create secret generic ticketchain-secrets \
  --from-literal=JWT_SECRET=<valor> \
  --from-literal=POSTGRES_USER=<valor> \
  --from-literal=POSTGRES_PASSWORD=<valor> \
  --from-literal=MINIO_ACCESS_KEY=<valor> \
  --from-literal=MINIO_SECRET_KEY=<valor> \
  -n ticketchain

# Reiniciar un deployment (para que tome nuevos secrets/configmap)
kubectl rollout restart deployment/event-registry -n ticketchain

# Ver estado de todos los deployments
kubectl get deployments -n ticketchain

# Eliminar todo el namespace (borra todo)
kubectl delete namespace ticketchain
```
