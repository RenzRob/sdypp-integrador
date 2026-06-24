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

### Qué hace cada archivo y qué pasa al aplicarlos

**Paso 1 — Se aplica `cluster-issuer.yaml`**

Registra en el cluster una "cuenta" en Let's Encrypt y guarda la configuración de cómo pedir certs (usando HTTP-01 via ingress-nginx). No emite ningún cert todavía. Solo queda guardado en el cluster un objeto llamado `letsencrypt-prod` que cert-manager va a consultar después.

**Paso 2 — Se aplica `ingress.yaml`**

Pasan dos cosas al mismo tiempo:

- **ingress-nginx** lee las reglas de ruteo: "todo lo que llegue a `ticketchain404.duckdns.org` mandalo al servicio `frontend-service:5173`". Lo aplica de inmediato, pero todavía sin HTTPS (el cert no existe aún).

- **cert-manager** detecta la anotación `cert-manager.io/cluster-issuer: letsencrypt-prod` en ese Ingress y arranca el proceso de emisión del cert.

**Paso 3 — cert-manager ejecuta el challenge HTTP-01**

cert-manager le pide a Let's Encrypt un cert para `ticketchain404.duckdns.org`. Let's Encrypt responde: "primero probá que controlás ese dominio". Para probarlo, cert-manager crea un Ingress temporario en el cluster que sirve un archivo especial en `http://ticketchain404.duckdns.org/.well-known/acme-challenge/<token>`. Let's Encrypt hace un GET a esa URL. Como DuckDNS apunta el dominio a la IP del cluster, el GET llega, y Let's Encrypt verifica que el token es correcto.

**Paso 4 — Let's Encrypt emite el cert**

Una vez verificado, Let's Encrypt entrega el certificado firmado a cert-manager. cert-manager lo guarda en un Secret llamado `ticketchain-tls` (con los campos `tls.crt` y `tls.key`). El Ingress temporario del challenge se elimina solo.

**Paso 5 — ingress-nginx empieza a servir HTTPS**

ingress-nginx detecta que el Secret `ticketchain-tls` ya existe, lo carga y empieza a terminar TLS en el puerto 443. A partir de acá `https://ticketchain404.duckdns.org` funciona con cert confiable. El HTTP (puerto 80) redirige a HTTPS automáticamente.

**Renovación automática:** cert-manager monitorea el Secret. Cuando el cert está por vencer (~30 días antes), repite los pasos 3-5 solo, sin intervención manual.

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

### Cómo se configuró, paso a paso

**Paso 1 — Se generaron los certificados con `gen-certs.sh`**

El script crea una CA propia del proyecto (una autoridad certificadora privada) y dos certificados firmados por ella: uno para el gateway y uno para el TrP. Quedan 6 archivos en `iac/k8s/certs/out/` (están en `.gitignore`, nunca se commitean):

- `ca.crt` / `ca.key` — la CA, la autoridad que firma los otros dos certs
- `gateway.crt` / `gateway.key` — cert del gateway; tiene el hostname `gateway.34.61.108.95.nip.io` como SAN para que TLS valide que estás hablando con el gateway real
- `trp.crt` / `trp.key` — cert del TrP; no necesita hostname porque solo lo usa como credencial de cliente (para identificarse, no para ser servidor)

**Paso 2 — Los certs se cargaron como Secrets en cada cluster**

En GKE se crearon dos Secrets:
- `gateway-tls`: contiene `gateway.crt` + `gateway.key`. Lo usa ingress-nginx para terminar TLS (el "candado" del HTTPS del gateway).
- `cross-cluster-ca`: contiene `ca.crt`. Lo usa ingress-nginx para verificar que quien llama presenta un cert firmado por esa CA.

En g-404 se crearon otros dos:
- `trp-tls`: contiene `trp.crt` + `trp.key`. El TrP lo presenta al gateway en cada llamada para identificarse.
- `cross-cluster-ca`: el mismo `ca.crt`. Lo usa el TrP para verificar que el gateway que responde tiene un cert legítimo (y no es alguien haciéndose pasar por el gateway).

**Paso 3 — Se aplicó el Ingress del gateway en GKE**

El `gateway-ingress.yaml` configura ingress-nginx para que en el endpoint `gateway.34.61.108.95.nip.io`:
- Sirva HTTPS usando el cert `gateway-tls`
- **Exija** que el cliente presente un cert de cliente firmado por la CA en `cross-cluster-ca` — si no hay cert o es inválido, ingress-nginx corta la conexión con 400 antes de que el request llegue al pod del gateway

**Paso 4 — Se deployaron los pods con los certs montados**

Los deployments del gateway (GKE) y del TrP (g-404) montan los Secrets como archivos dentro del pod:
- `/certs/tls.crt` y `/certs/tls.key` — el cert propio (gateway o TrP según el pod)
- `/ca/ca.crt` — la CA para verificar al otro lado

**Paso 5 — El código usa esos archivos en cada llamada HTTP**

En `pool.py`, cada vez que el TrP llama al gateway hace:
```python
requests.get(GATEWAY_URL, cert=("/certs/tls.crt", "/certs/tls.key"), verify="/ca/ca.crt")
```
Esto significa: "presentá el cert del TrP al conectarte, y verificá que el servidor tenga un cert firmado por nuestra CA".

El gateway no necesita código para verificar al TrP — eso ya lo hace ingress-nginx antes de que el request llegue al pod.

**Así queda en runtime:**

El TrP inicia la conexión → presenta `trp.crt` → ingress-nginx verifica contra `ca.crt` → si válido, pasa el request al pod del gateway → el pod responde → el TrP verifica que el cert del gateway (`gateway.crt`) fue firmado por la misma CA → si válido, procesa la respuesta. Si cualquiera de las dos verificaciones falla, la conexión se corta.

### Archivos relevantes
```
iac/k8s/certs/gen-certs.sh                                         # genera CA + certs
iac/k8s/cluster-services/network/gateway-ingress.yaml              # Ingress con verificación mTLS
iac/k8s/cluster-services/services/mining-gateway-deployment.yaml   # monta /certs y /ca en el pod
iac/k8s/cluster-mining/services/transaction-pool-deployment.yaml   # monta /certs y /ca en el pod
backend/transaction-pool/pool.py                                    # usa cert= y verify= en requests
```

### Para qué casos nos protege el mTLS

El endpoint del gateway (`https://gateway.34.61.108.95.nip.io`) es **público** — cualquier persona en internet puede hacer un request. mTLS cierra los vectores de ataque que HTTPS solo no cubre.

---

**Caso 1 — Alguien descubre la URL del gateway e intenta inyectar tareas falsas**

Sin mTLS: un atacante hace `POST /result` con un bloque falso → el gateway lo publica en la cola `nct_results` → el NCT intenta validar el bloque (falla el hash, pero igual genera ruido y carga).

Con mTLS: ingress-nginx rechaza la conexión antes de que llegue al pod porque el atacante no tiene un cert firmado por nuestra CA. Respuesta: `400`. No hay nada que hacer desde afuera sin el `trp.crt` + `trp.key`.

---

**Caso 2 — Alguien intercepta el tráfico entre clusters (man-in-the-middle)**

Sin TLS: el contenido de las tareas de minado y los bloques confirmados viajaría en texto plano por internet.

Con TLS pero sin verificar el servidor: un atacante podría poner un proxy entre el TrP y el gateway, interceptar los datos y hacer pasar su propio servidor como si fuera el gateway legítimo.

Con mTLS: el TrP verifica que el cert del gateway fue firmado por nuestra CA (el `ca.crt` que tiene montado en `/ca/`). Si alguien se interpone con un cert distinto, la conexión se corta del lado del TrP antes de enviar nada. Nadie puede hacerse pasar por el gateway sin tener `gateway.key`, que nunca sale del cluster.

---

**Caso 3 — Otro servicio del cluster del profe intenta llamar al gateway**

El cluster g-404 es compartido (otros grupos de la materia tienen sus propios namespaces). Sin mTLS, cualquier pod del cluster podría llamar al gateway de nuestro grupo. Con mTLS, solo el pod del TrP puede hacerlo porque es el único que tiene montado el `trp-tls` Secret con el cert firmado por nuestra CA.

---

**Lo que mTLS NO hace:**

No reemplaza la lógica de validación del NCT. Si el TrP enviara un bloque con un nonce incorrecto, el mTLS lo dejaría pasar igual — la verificación criptográfica del bloque (que el hash empiece con los ceros de dificultad) la hace el NCT por separado. mTLS solo controla **quién puede hablar**, no **qué dice**.

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
