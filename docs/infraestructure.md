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
│   │   └── network/               — ingress (HTTPS público + mTLS para mining-gateway)
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
