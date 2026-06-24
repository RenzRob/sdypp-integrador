# HTTPS en TicketChain

Hay dos capas de HTTPS con mecanismos distintos según quién se comunica con quién.

---

## 1. Frontend público → usuarios (Let's Encrypt)

**Dominio:** `https://ticketchain404.duckdns.org`  
**Mecanismo:** TLS estándar (una sola vía), certificado confiable de Let's Encrypt  
**Emite y renueva:** cert-manager corriendo en GKE, automáticamente

### Por qué este mecanismo
Los browsers rechazan certificados self-signed. Let's Encrypt emite certs confiables gratis.
cert-manager los renueva solos (antes de que venzan). El usuario no ve ninguna advertencia.

### Cómo funciona el HTTP-01 challenge (teoría)

Let's Encrypt necesita verificar que quien pide el cert **realmente controla el dominio**.
El mecanismo HTTP-01 lo hace así:

```
cert-manager                Let's Encrypt             Browser del usuario
     │                           │
     │── "quiero cert para       │
     │    ticketchain404.        │
     │    duckdns.org" ─────────►│
     │                           │
     │◄── "OK, primero probá     │
     │     que controlás el      │
     │     dominio: poné un      │
     │     archivo en            │
     │     http://<dominio>/     │
     │     .well-known/acme-     │
     │     challenge/<token>"    │
     │                           │
     │ (cert-manager crea un     │
     │  Ingress temporario que   │
     │  sirve ese archivo vía    │
     │  ingress-nginx)           │
     │                           │
     │── "listo, ya está" ──────►│
     │                           │
     │            Let's Encrypt hace GET a
     │            http://ticketchain404.duckdns.org/
     │            .well-known/acme-challenge/<token>
     │            Si responde con el valor correcto
     │            → dominio verificado
     │                           │
     │◄── cert firmado ──────────│
     │                           │
     │ (cert-manager guarda      │
     │  el cert en el Secret     │
     │  ticketchain-tls)         │
```

**Por qué funciona:** si podés servir un archivo en `http://tudominio/.well-known/acme-challenge/X`, es porque controlás el servidor al que apunta ese dominio en DNS. Let's Encrypt solo verifica que el token que puso cert-manager en el Ingress sea el que ellos esperan.

**Qué pasa sin DuckDNS:** si el dominio no apuntara a la IP real del ingress, Let's Encrypt no podría hacer el GET → el challenge falla → no emite el cert. Por eso el DNS tiene que estar configurado correctamente antes de aplicar el Ingress con la anotación `cert-manager.io/cluster-issuer`.

### Infraestructura involucrada
- **DuckDNS** (`ticketchain404.duckdns.org` → `34.61.108.95`): DNS gratuito, sin registrar dominio propio
- **ingress-nginx** en GKE: termina el TLS, expone puerto 443, fuerza redirect HTTP→HTTPS, y sirve el endpoint del challenge durante la emisión
- **cert-manager** v1.20.2 + `ClusterIssuer` `letsencrypt-prod`: orquesta el challenge, solicita el cert, lo almacena y lo renueva (cada ~60 días, antes de que venza)
- **Secret** `ticketchain-tls` en namespace `g-404`: almacena el cert+key actual, lo rota cert-manager sin intervención manual

### Archivos relevantes
```
iac/k8s/cluster-services/network/ingress.yaml          # Ingress del frontend con TLS
iac/k8s/cluster-services/network/cluster-issuer.yaml   # ClusterIssuer Let's Encrypt
```

### Comandos para setup (ya aplicados, solo si hay que rehacer)
```bash
# Instalar cert-manager en GKE
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.20.2/cert-manager.yaml

# Aplicar ClusterIssuer + Ingress
kubectl apply -f iac/k8s/cluster-services/network/cluster-issuer.yaml
kubectl apply -f iac/k8s/cluster-services/network/ingress.yaml

# Verificar que el cert fue emitido
kubectl get certificate -n g-404
# READY=True significa que Let's Encrypt emitió el cert correctamente
```

---

## 2. Cross-cluster: mining-gateway ↔ TrP (mTLS)

**Endpoints:**
- `https://gateway.34.61.108.95.nip.io/next-task` ← TrP lo llama para pedir tareas
- `https://gateway.34.61.108.95.nip.io/result`    ← TrP lo llama para entregar el bloque minado

**Mecanismo:** TLS mutuo (mTLS) — ambos lados se identifican con certificados  
**CA:** propia del proyecto (self-signed), generada con `gen-certs.sh`

### Por qué este mecanismo y no Let's Encrypt
El tráfico cross-cluster es **máquina-a-máquina** (el TrP llama al gateway, no un browser).
No hace falta que el cert sea "confiable" para browsers — alcanza con que ambos lados confíen en la misma CA propia. Además:
- La IP del gateway (`34.61.108.95`) ya tiene un hostname válido via nip.io, sin registrar dominio
- El TrP (en g-404) no tiene IP pública — **solo hace llamadas salientes** (modelo PULL), nunca recibe conexiones entrantes. No necesita un cert de servidor

### Cómo funciona mTLS aquí

```
TrP (g-404)                          mining-gateway (GKE)
    │                                         │
    │── GET /next-task + cert cliente ──────►│
    │     (presenta trp.crt firmado por CA)  │
    │                              verifica │◄── ingress-nginx verifica
    │                              cert vs  │    ca.crt (cross-cluster-ca)
    │◄── respuesta si cert válido ──────────│
```

El ingress-nginx de GKE verifica el cert de cliente del TrP antes de que el request llegue al pod. Sin cert válido → 400 (rechazado por el Ingress, no llega al código).

El TrP también verifica el cert de servidor del gateway usando la misma CA (`verify=CA_CERT`). Así ningún lado puede ser suplantado.

### Archivos relevantes
```
iac/k8s/certs/gen-certs.sh                                    # Genera CA + certs
iac/k8s/cluster-services/network/gateway-ingress.yaml         # Ingress con auth-tls-*
iac/k8s/cluster-services/services/mining-gateway-deployment.yaml   # monta certs en /certs /ca
iac/k8s/cluster-mining/services/transaction-pool-deployment.yaml   # monta certs en /certs /ca
backend/mining-gateway/main.py                                 # no valida en código (lo hace Ingress)
backend/transaction-pool/pool.py                               # requests con cert= y verify=
```

### Comandos para setup (ya aplicados, solo si hay que rehacer)

**Paso 1: Generar CA + certificados**
```bash
# El cert del gateway tiene el SAN = hostname real del gateway
GATEWAY_HOST=gateway.34.61.108.95.nip.io \
  iac/k8s/certs/gen-certs.sh

# Quedan en iac/k8s/certs/out/ (gitignored — NO commitear)
#   ca.crt         ← CA del proyecto
#   ca.key         ← clave privada de la CA (guardar segura)
#   gateway.crt    ← cert de servidor del gateway (SAN = nip.io hostname)
#   gateway.key    ← clave privada del gateway
#   trp.crt        ← cert de cliente del TrP (solo se usa para identificarse)
#   trp.key        ← clave privada del TrP
```

**Paso 2: Crear Secrets en GKE (mining-gateway)**
```bash
# TLS del Ingress del gateway (cert de servidor)
kubectl create secret tls gateway-tls \
  --cert=iac/k8s/certs/out/gateway.crt \
  --key=iac/k8s/certs/out/gateway.key \
  -n g-404

# CA para verificar el cert de cliente del TrP
kubectl create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt \
  -n g-404
```

**Paso 3: Crear Secrets en g-404 (transaction-pool)**
```bash
# Cert de cliente del TrP (se presenta al gateway)
kubectl --kubeconfig=renzo.yaml create secret tls trp-tls \
  --cert=iac/k8s/certs/out/trp.crt \
  --key=iac/k8s/certs/out/trp.key \
  -n g-404

# CA para verificar el cert de servidor del gateway
kubectl --kubeconfig=renzo.yaml create secret generic cross-cluster-ca \
  --from-file=ca.crt=iac/k8s/certs/out/ca.crt \
  -n g-404
```

**Verificar que mTLS funciona**
```bash
# Con cert de cliente → debe responder 204 (sin tarea) o 200 (con tarea JSON)
curl -s -o /dev/null -w "CON cert → HTTP %{http_code}\n" \
  --cert iac/k8s/certs/out/trp.crt \
  --key  iac/k8s/certs/out/trp.key \
  --cacert iac/k8s/certs/out/ca.crt \
  https://gateway.34.61.108.95.nip.io/next-task

# Sin cert de cliente → debe rechazar con 400
curl -s -o /dev/null -w "SIN cert → HTTP %{http_code}\n" \
  --cacert iac/k8s/certs/out/ca.crt \
  https://gateway.34.61.108.95.nip.io/next-task
```

---

## Resumen comparativo

| | Frontend (Let's Encrypt) | Cross-cluster (mTLS) |
|---|---|---|
| **Quién se comunica** | Browser de usuario → GKE | TrP (g-404) → gateway (GKE) |
| **Cert confiable para browsers** | Sí (necesario) | No (máquina-a-máquina) |
| **CA** | Let's Encrypt | Propia del proyecto |
| **Verifica servidor** | Sí (el browser verifica) | Sí (el TrP verifica el gateway) |
| **Verifica cliente** | No | Sí (Ingress verifica al TrP) |
| **Renovación** | Automática (cert-manager) | Manual (cuando vence el cert, ~10 años) |
| **Código que lo implementa** | Solo infra k8s, sin código | `pool.py`: `requests` con `cert=` y `verify=` |
| **Secret en k8s** | `ticketchain-tls` | `gateway-tls`, `trp-tls`, `cross-cluster-ca` |
