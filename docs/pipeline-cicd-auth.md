# Pipeline CI/CD — Autenticación

## Registry de imágenes

Las imágenes Docker del proyecto se publican en **GitHub Container Registry (GHCR)**:

- **Registry:** `ghcr.io`
- **Prefijo:** `ghcr.io/renzrob/<servicio>:latest`

El registry es **privado** — tanto el push (CI) como el pull (Kubernetes) requieren autenticación.

## Flujo completo

```
GitHub Actions (push a main)
  │
  ├─ login a ghcr.io con secrets.GHCR_TOKEN
  ├─ docker build + push → ghcr.io/renzrob/<servicio>:latest
  │
  └─ kubectl rollout restart deployment/...
       │
       └─ Kubernetes hace pull de la imagen
            usando el Secret "ghcr-secret" (PAT almacenado en el cluster)
```

## Secrets en juego

### GitHub Actions Secrets (configurados en el repo)

| Secret | Para qué |
|---|---|
| `GHCR_TOKEN` | Push de imágenes a ghcr.io |
| `KUBE_CONFIG_SERVICES` | kubeconfig del cluster-services (GKE), en base64 |
| `KUBE_CONFIG_MINING` | kubeconfig del cluster-mining (g-404), en base64 |

El workflow decodifica el kubeconfig en cada deploy:

```yaml
echo "${{ secrets.KUBE_CONFIG_SERVICES }}" | base64 -d > /tmp/kubeconfig
echo "KUBECONFIG=/tmp/kubeconfig" >> "$GITHUB_ENV"
```

El kubeconfig contiene el endpoint del cluster + certificado + token de una service account con permisos para hacer `apply` y `rollout restart` en el namespace `g-404`. Se genera una sola vez desde el cluster y se carga como secret en el repo.

### Kubernetes Secret (en el cluster)

| Secret | Dónde vive | Para qué |
|---|---|---|
| `ghcr-secret` | Namespace `g-404` en cada cluster | Pull de imágenes desde los pods |

## Configuración en los deployments

Todos los deployments declaran el `imagePullSecret`:

```yaml
imagePullSecrets:
  - name: ghcr-secret
containers:
  - image: ghcr.io/renzrob/<servicio>:latest
    imagePullPolicy: Always
```

## Crear el secret en el cluster (setup inicial)

El secret `ghcr-secret` debe crearse manualmente una sola vez en cada cluster:

```bash
kubectl create secret docker-registry ghcr-secret \
  --docker-server=ghcr.io \
  --docker-username=renzrob \
  --docker-password=<PAT_con_scope_read:packages> \
  --namespace g-404
```

Aplica tanto para `cluster-services` como para `cluster-mining`.
