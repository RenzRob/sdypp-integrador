#!/usr/bin/env bash
#
# Genera la CA + los certificados (server/client) para el mTLS entre clusters.
#
#   gateway  → usado por el mining-gateway (server de su ingress + client al llamar al TrP)
#   trp      → usado por el transaction-pool (server de su ingress + client al llamar al gateway)
#
# Uso:
#   GATEWAY_HOST=gateway.midominio.com TRP_HOST=trp.midominio.com ./gen-certs.sh
#
# Los .key son privados: NO commitear (out/ está en .gitignore).
set -euo pipefail

GATEWAY_HOST="${GATEWAY_HOST:-CAMBIAR-gateway.tu-dominio.com}"
TRP_HOST="${TRP_HOST:-CAMBIAR-trp.tu-dominio.com}"
OUT="${OUT:-$(dirname "$0")/out}"
DAYS=3650

mkdir -p "$OUT"
cd "$OUT"

# ── 1) CA propia ────────────────────────────────────────────────────────────
openssl genrsa -out ca.key 4096
openssl req -x509 -new -nodes -key ca.key -sha256 -days "$DAYS" \
  -subj "/CN=ticketchain-cross-cluster-CA" -out ca.crt

# ── 2) Cert de servicio (sirve como server Y client) ────────────────────────
gen_svc() {
  local name="$1" host="$2"
  openssl genrsa -out "${name}.key" 2048
  openssl req -new -key "${name}.key" -subj "/CN=${host}" -out "${name}.csr"
  cat > "${name}.ext" <<EOF
basicConstraints=CA:FALSE
keyUsage=digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth,clientAuth
subjectAltName=DNS:${host}
EOF
  openssl x509 -req -in "${name}.csr" -CA ca.crt -CAkey ca.key -CAcreateserial \
    -days "$DAYS" -sha256 -extfile "${name}.ext" -out "${name}.crt"
  rm -f "${name}.csr" "${name}.ext"
}

gen_svc gateway "$GATEWAY_HOST"
gen_svc trp "$TRP_HOST"

echo ""
echo "✓ Certificados generados en: $OUT"
echo ""
echo "── Crear secrets en el CLUSTER PROPIO (mining-gateway) ──"
echo "kubectl create secret tls gateway-tls --cert=$OUT/gateway.crt --key=$OUT/gateway.key -n <ns-propio>"
echo "kubectl create secret generic cross-cluster-ca --from-file=ca.crt=$OUT/ca.crt -n <ns-propio>"
echo ""
echo "── Crear secrets en el CLUSTER DEL PROFE (transaction-pool) ──"
echo "kubectl --kubeconfig=renzo.yaml create secret tls trp-tls --cert=$OUT/trp.crt --key=$OUT/trp.key -n g-404"
echo "kubectl --kubeconfig=renzo.yaml create secret generic cross-cluster-ca --from-file=ca.crt=$OUT/ca.crt -n g-404"
