#!/usr/bin/env bash
set -euo pipefail

# ═══════════════════════════════════════════════════════════════════════════════
#  TicketChain — Stress Test Runner
#  Modificá las variables de esta sección y corré: ./run.sh
# ═══════════════════════════════════════════════════════════════════════════════

BASE_URL="https://ticketchain404.duckdns.org"

ADMIN_EMAIL="ticket_chain_admin@gmail.com"
ADMIN_PASSWORD="admin"

LOAD_TEST_EMAIL="loadtest@ticketchain.com"
LOAD_TEST_PASSWORD="LoadTest2026!"

EVENTS=5                  # cantidad de eventos a crear
TICKETS_PER_EVENT=150000  # tickets por evento (total = EVENTS × TICKETS_PER_EVENT)

RATE=5000                 # iteraciones (buy-requests) por minuto
DURATION="30m"            # duración del test

# CONFIRM_RATIO="0.10"   # casi todo cancel — estresa la API pura
# CONFIRM_RATIO="0.30"   # default — balance entre API y blockchain
# CONFIRM_RATIO="0.80"   # presión máxima sobre RabbitMQ/NCT/mineros
CONFIRM_RATIO="0.40"      # fracción de requests que confirman (van a blockchain)

# ═══════════════════════════════════════════════════════════════════════════════

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${CYAN}${BOLD}▶  $*${NC}"; }
ok()      { echo -e "${GREEN}   ✓  $*${NC}"; }
warn()    { echo -e "${YELLOW}   ⚠  $*${NC}"; }
die()     { echo -e "${RED}${BOLD}   ✗  $*${NC}"; exit 1; }

# ── Header ───────────────────────────────────────────────────────────────────
echo
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║        TicketChain — Stress Test Runner                 ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo -e "  Base URL:     ${CYAN}${BASE_URL}${NC}"
echo -e "  Eventos:      ${EVENTS} × ${TICKETS_PER_EVENT} tickets (total: $(( EVENTS * TICKETS_PER_EVENT )))"
echo -e "  Carga:        ${BOLD}${RATE} RPM${NC} durante ${BOLD}${DURATION}${NC}"
echo -e "  Confirm:      ${CONFIRM_RATIO} (van a blockchain)"
echo

# ── Dependencias ─────────────────────────────────────────────────────────────
info "Verificando dependencias..."

command -v python3 &>/dev/null || die "python3 no encontrado. Instalá Python 3."
command -v k6     &>/dev/null || die "k6 no encontrado. Instalá con: brew install k6"

PYTHON="python3"

ok "python3 $(python3 --version 2>&1 | cut -d' ' -f2)"
ok "k6 $(k6 version 2>&1 | head -1)"

# ── Validaciones ─────────────────────────────────────────────────────────────
info "Validando configuración..."

[[ "$ADMIN_PASSWORD" == "CAMBIAME" ]] && die "Editá ADMIN_PASSWORD en este script antes de correrlo."
[[ -z "$BASE_URL"            ]] && die "BASE_URL no puede estar vacío."
[[ -z "$ADMIN_EMAIL"         ]] && die "ADMIN_EMAIL no puede estar vacío."
[[ -z "$LOAD_TEST_EMAIL"     ]] && die "LOAD_TEST_EMAIL no puede estar vacío."
[[ -z "$LOAD_TEST_PASSWORD"  ]] && die "LOAD_TEST_PASSWORD no puede estar vacío."
[[ "$EVENTS" -lt 1           ]] && die "EVENTS debe ser >= 1."
[[ "$TICKETS_PER_EVENT" -lt 1000 ]] && warn "TICKETS_PER_EVENT < 1000 puede agotar el inventario rápido."

ok "Configuración válida"

# ── Crear directorio de resultados ────────────────────────────────────────────
mkdir -p results

# ── Setup (eventos + login usuario de carga) ──────────────────────────────────
info "Corriendo setup.py..."
echo

"${PYTHON}" setup.py \
  --base-url           "$BASE_URL" \
  --admin-email        "$ADMIN_EMAIL" \
  --admin-password     "$ADMIN_PASSWORD" \
  --load-test-email    "$LOAD_TEST_EMAIL" \
  --load-test-password "$LOAD_TEST_PASSWORD" \
  --events             "$EVENTS" \
  --tickets-per-event  "$TICKETS_PER_EVENT" \
  --output             test-data.json

echo

# ── Stress test ───────────────────────────────────────────────────────────────
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RESULT_FILE="results/run-${TIMESTAMP}.json"

info "Iniciando stress test con k6..."
echo -e "  Resultados → ${CYAN}${RESULT_FILE}${NC}"
echo

k6 run \
  --out "json=${RESULT_FILE}" \
  -e "RATE=${RATE}" \
  -e "DURATION=${DURATION}" \
  -e "CONFIRM=${CONFIRM_RATIO}" \
  stress-test.js

echo
ok "Test finalizado. Resultados guardados en ${RESULT_FILE}"
echo
