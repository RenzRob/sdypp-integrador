# Infraestructura TicketChain

## Estructura

```
iac/
├── local/                — desarrollo local
│   ├── docker-compose.yml
│   ├── run_local.sh
│   └── .env              ← commiteado, valores de desarrollo
├── k8s/
│   ├── config/           — namespace, configmap
│   ├── deployments/
│   │   ├── infrastructure/  — postgres, redis, rabbitmq, minio, nginx
│   │   └── services/        — microservicios de la aplicación
│   └── network/          — ingress
└── nginx/                — configuración de nginx (local y k8s)
```

## Aplicar al cluster (GKE)

```bash
kubectl apply -f iac/k8s/config/
kubectl apply -f iac/k8s/deployments/infrastructure/
kubectl apply -f iac/k8s/deployments/services/
kubectl apply -f iac/k8s/network/
```

> **Importante**: antes de aplicar los deployments, crear los secrets manualmente (ver abajo).

---

## Secrets

Los secrets **nunca se commitean** con valores reales. Crearlos manualmente en el cluster:

```bash
kubectl create secret generic ticketchain-secrets \
  --from-literal=JWT_SECRET=<string largo y aleatorio> \
  --from-literal=POSTGRES_USER=<usuario> \
  --from-literal=POSTGRES_PASSWORD=<password> \
  --from-literal=MINIO_ACCESS_KEY=<access key> \
  --from-literal=MINIO_SECRET_KEY=<secret key> \
  -n ticketchain
```

### Keys requeridas

| Key | Descripción |
|---|---|
| `JWT_SECRET` | String aleatorio para firmar tokens JWT |
| `POSTGRES_USER` | Usuario de PostgreSQL |
| `POSTGRES_PASSWORD` | Password de PostgreSQL |
| `MINIO_ACCESS_KEY` | Usuario de MinIO (mínimo 3 caracteres) |
| `MINIO_SECRET_KEY` | Password de MinIO (mínimo 8 caracteres) |

### Verificar que los secrets existen

```bash
kubectl get secret ticketchain-secrets -n ticketchain
```

### Regenerar un secret

```bash
kubectl delete secret ticketchain-secrets -n ticketchain
# volver a ejecutar el kubectl create secret de arriba
```
