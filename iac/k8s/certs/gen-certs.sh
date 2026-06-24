#!/usr/bin/env bash
#
# Genera la CA + los certificados para el mTLS entre clusters (modelo PULL).
#
#   gateway → cert de SERVER del mining-gateway (lo usa el Ingress nginx de GKE).
#             Su SAN debe matchear el host público del gateway.
#   trp     → cert de CLIENTE del transaction-pool (lo presenta al gateway).
#             El SAN no se usa (se valida por CA), es solo un label.
#
# Uso:
#   GATEWAY_HOST=gateway.34.61.108.95.nip.io ./gen-certs.sh
#
# Los .key son privados: NO commitear (out/ está en .gitignore).
set -euo pipefail

# Host público del gateway en GKE (nip.io = IP del ingress-nginx, sin registrar dominio)
GATEWAY_HOST="${GATEWAY_HOST:-gateway.34.61.108.95.nip.io}"
TRP_HOST="${TRP_HOST:-trp-client}"
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
