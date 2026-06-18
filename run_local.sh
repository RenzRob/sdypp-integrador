#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── colores ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC}  $*"; }
ok()      { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

# ── banner ────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
echo "  TicketChain — Grupo 404 · UNLu 2026"
echo "  Plataforma de Ticketing Descentralizada sobre Blockchain"
echo -e "${NC}"

# ── detectar docker compose (v2 plugin o v1 standalone) ──────────────────────
if docker compose version &>/dev/null 2>&1; then
  COMPOSE="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE="docker-compose"
else
  die "No se encontró 'docker compose' ni 'docker-compose'. Instalá Docker Desktop."
fi

# ── verificar que Docker esté corriendo ───────────────────────────────────────
if ! docker info &>/dev/null 2>&1; then
  die "Docker no está corriendo. Iniciá Docker Desktop e intentá de nuevo."
fi
ok "Docker activo — usando: $COMPOSE"

# ── .env ──────────────────────────────────────────────────────────────────────
if [ ! -f "$SCRIPT_DIR/.env" ]; then
  if [ -f "$SCRIPT_DIR/.env.example" ]; then
    cp "$SCRIPT_DIR/.env.example" "$SCRIPT_DIR/.env"
    warn ".env creado desde .env.example"
  else
    info "Generando .env con valores por defecto para desarrollo local..."
    cat > "$SCRIPT_DIR/.env" <<'ENVEOF'
REDIS_URL=redis://redis:6379
RABBITMQ_URL=amqp://guest:guest@rabbitmq:5672
JWT_SECRET=ticketchain_local_dev_secret_cambiar_en_produccion
CORS_ORIGIN=http://localhost
ENVEOF
    warn ".env generado con valores por defecto. Editalo antes de usar en producción."
  fi
else
  ok ".env encontrado"
fi

# ── flags opcionales ──────────────────────────────────────────────────────────
BUILD_FLAG="--build"
DETACH_FLAG="-d"

for arg in "$@"; do
  case "$arg" in
    --no-build) BUILD_FLAG="" ;;
    --attach)   DETACH_FLAG="" ;;
    --down)
      info "Deteniendo y eliminando contenedores..."
      $COMPOSE down
      exit 0
      ;;
    --down-volumes)
      warn "Deteniendo contenedores y borrando volúmenes (se pierde la blockchain en Redis)..."
      $COMPOSE down -v
      exit 0
      ;;
    --from-scratch)
      warn "Borrando volúmenes y levantando desde cero..."
      $COMPOSE down -v
      ;;
    --logs)
      $COMPOSE logs -f
      exit 0
      ;;
    --help|-h)
      echo ""
      echo "Uso: $0 [opciones]"
      echo ""
      echo "  (sin flags)       Construye imágenes y levanta todos los servicios en background"
      echo "  --no-build        Levanta sin rebuilding (más rápido si el código no cambió)"
      echo "  --attach          Muestra los logs en primer plano (Ctrl+C para detener)"
      echo "  --down            Detiene y elimina los contenedores"
      echo "  --down-volumes    Detiene, elimina contenedores y borra volúmenes"
      echo "  --from-scratch    Borra volúmenes y levanta todo desde cero"
      echo "  --logs            Sigue los logs de todos los servicios"
      echo ""
      exit 0
      ;;
  esac
done

# ── levantar servicios ────────────────────────────────────────────────────────
info "Construyendo imágenes y levantando servicios..."
echo ""
# shellcheck disable=SC2086
$COMPOSE up $BUILD_FLAG $DETACH_FLAG

# ── solo si corrió en detached mode ───────────────────────────────────────────
if [ -n "$DETACH_FLAG" ]; then
  echo ""
  info "Esperando que los healthchecks pasen..."
  sleep 8

  echo ""
  $COMPOSE ps
  echo ""
  echo -e "${GREEN}${BOLD}  TicketChain está corriendo!${NC}"
  echo ""
  echo "  Puntos de acceso:"
  echo "    Web:              http://localhost"
  echo "    RabbitMQ Manager: http://localhost:15672  (usuario: guest / pass: guest)"
  echo "    Status API:       http://localhost/api/status/"
  echo "    NCT (interno):    http://localhost:8000/ping"
  echo ""
  echo "  Comandos útiles:"
  echo "    Ver logs:         $0 --logs"
  echo "    Detener:          $0 --down"
  echo "    Detener + limpiar: $0 --down-volumes
    Arrancar desde cero: $0 --from-scratch"
  echo ""
fi
