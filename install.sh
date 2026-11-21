#!/usr/bin/env bash
set -euo pipefail

# Lumina Installer & Configurator (Linux ARM64 / x86_64)
# Usage: bash install.sh

BOLD="\033[1m"
GREEN="\033[0;32m"
YELLOW="\033[0;33m"
CYAN="\033[0;36m"
RED="\033[0;31m"
NC="\033[0m"

echo -e "${BOLD}Lumina Installer${NC}"
echo "----------------------------------------"

if [ ! -f "deploy/docker-compose.yml" ] || [ ! -f ".env.example" ]; then
  echo -e "${RED}[ERROR] 请在项目根目录 (lumina-img/) 中运行此脚本。${NC}"
  exit 1
fi

# [1/5] Environment Check
echo -e "${CYAN}[1/5] 检查运行环境...${NC}"
if ! command -v docker >/dev/null 2>&1; then
  read -rp "未检测到 Docker，是否自动安装？[y/N]: " INSTALL_DOCKER
  if [[ "${INSTALL_DOCKER,,}" == "y" ]]; then
    curl -fsSL https://get.docker.com | sh
    systemctl enable --now docker 2>/dev/null || true
  else
    echo -e "${RED}[ERROR] 需要 Docker 环境，安装中止。${NC}"
    exit 1
  fi
fi

if ! docker compose version >/dev/null 2>&1; then
  echo -e "${RED}[ERROR] 需要 Docker Compose v2 插件，安装中止。${NC}"
  exit 1
fi
echo -e "${GREEN}OK${NC} ($(docker --version | cut -d',' -f1))"

# [2/5] Deployment Mode
echo ""
echo -e "${CYAN}[2/5] 部署模式${NC}"
echo "  1) 域名模式 (HTTPS / Caddy 自动证书)"
echo "  2) IP 模式 (HTTP :80)"
read -rp "选择模式 [1/2, 默认 2]: " DEPLOY_MODE
DEPLOY_MODE="${DEPLOY_MODE:-2}"

APP_DOMAIN=":80"
CDN_DOMAIN=":8088"
APP_PUBLIC_URL="http://localhost"
CDN_PUBLIC_URL="http://localhost"

if [ "$DEPLOY_MODE" = "1" ]; then
  read -rp "主站域名 (如 img.example.com): " APP_DOMAIN
  while [ -z "$APP_DOMAIN" ]; do
    read -rp "主站域名不能为空: " APP_DOMAIN
  done
  read -rp "独立 CDN 域名 (可回车留空与主站共用): " CDN_INPUT
  APP_PUBLIC_URL="https://${APP_DOMAIN}"
  if [ -z "$CDN_INPUT" ] || [ "$CDN_INPUT" = "$APP_DOMAIN" ]; then
    CDN_DOMAIN=":8088"
    CDN_PUBLIC_URL="https://${APP_DOMAIN}"
  else
    CDN_DOMAIN="$CDN_INPUT"
    CDN_PUBLIC_URL="https://${CDN_DOMAIN}"
  fi
else
  DETECTED_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")
  read -rp "服务器 IP [默认 ${DETECTED_IP}]: " SERVER_IP
  SERVER_IP="${SERVER_IP:-$DETECTED_IP}"
  APP_PUBLIC_URL="http://${SERVER_IP}"
  CDN_PUBLIC_URL="http://${SERVER_IP}"
fi

# [3/5] Administrator & Storage
echo ""
echo -e "${CYAN}[3/5] 账号与存储配置${NC}"
gen_hex() {
  openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}
read_existing_env() {
  [ -f ".env" ] && grep -E "^$1=" .env | head -n1 | cut -d'=' -f2- || true
}

DEFAULT_USER=$(read_existing_env ADMIN_USERNAME); DEFAULT_USER="${DEFAULT_USER:-admin}"
DEFAULT_EMAIL=$(read_existing_env ADMIN_EMAIL); DEFAULT_EMAIL="${DEFAULT_EMAIL:-admin@example.com}"
DEFAULT_PASS=$(read_existing_env ADMIN_PASSWORD); DEFAULT_PASS="${DEFAULT_PASS:-Lumina_$(gen_hex 6)!}"

read -rp "管理员用户名 [默认 ${DEFAULT_USER}]: " ADMIN_USERNAME
ADMIN_USERNAME="${ADMIN_USERNAME:-$DEFAULT_USER}"
read -rp "管理员邮箱 [默认 ${DEFAULT_EMAIL}]: " ADMIN_EMAIL
ADMIN_EMAIL="${ADMIN_EMAIL:-$DEFAULT_EMAIL}"
read -rp "管理员密码 [回车沿用/自动生成]: " ADMIN_PASSWORD
ADMIN_PASSWORD="${ADMIN_PASSWORD:-$DEFAULT_PASS}"

read -rp "启用外部 S3 / R2 存储？[y/N]: " ENABLE_R2
R2_ENABLED="false"
R2_ACCOUNT_ID=""
R2_ENDPOINT=""
R2_BUCKET=""
R2_ACCESS_KEY_ID=""
R2_SECRET_ACCESS_KEY=""
R2_PUBLIC_URL=""

if [[ "${ENABLE_R2,,}" == "y" ]]; then
  R2_ENABLED="true"
  read -rp "Endpoint URL: " R2_ENDPOINT
  read -rp "Bucket: " R2_BUCKET
  read -rp "Access Key ID: " R2_ACCESS_KEY_ID
  read -rp "Secret Access Key: " R2_SECRET_ACCESS_KEY
  read -rp "公开访问域名 (可选): " R2_PUBLIC_URL
fi

# [4/5] Write .env (preserving existing DB/Redis/JWT/imgproxy secrets)
echo ""
echo -e "${CYAN}[4/5] 生成配置文件...${NC}"
if [ -f ".env" ]; then
  BACKUP_NAME=".env.bak.$(date +%Y%m%d_%H%M%S)"
  cp .env "$BACKUP_NAME"
  echo -e "${YELLOW}已备份原配置: ${BACKUP_NAME}${NC}"
fi

JWT_SECRET=$(read_existing_env JWT_SECRET); JWT_SECRET="${JWT_SECRET:-$(gen_hex 32)}"
LOCAL_SIGN_SECRET=$(read_existing_env LOCAL_SIGN_SECRET); LOCAL_SIGN_SECRET="${LOCAL_SIGN_SECRET:-$(gen_hex 32)}"
PG_PASS=$(read_existing_env POSTGRES_PASSWORD); PG_PASS="${PG_PASS:-$(gen_hex 16)}"
REDIS_PASS=$(read_existing_env REDIS_PASSWORD); REDIS_PASS="${REDIS_PASS:-$(gen_hex 16)}"
IMG_KEY=$(read_existing_env IMGPROXY_KEY); IMG_KEY="${IMG_KEY:-$(gen_hex 32)}"
IMG_SALT=$(read_existing_env IMGPROXY_SALT); IMG_SALT="${IMG_SALT:-$(gen_hex 32)}"

AI_API_BASE=$(read_existing_env AI_API_BASE); AI_API_BASE="${AI_API_BASE:-https://api.openai.com/v1}"
AI_API_KEY=$(read_existing_env AI_API_KEY)
AI_MODEL=$(read_existing_env AI_MODEL); AI_MODEL="${AI_MODEL:-gpt-4o-mini}"
SMTP_HOST=$(read_existing_env SMTP_HOST)
SMTP_PORT=$(read_existing_env SMTP_PORT); SMTP_PORT="${SMTP_PORT:-587}"
SMTP_USER=$(read_existing_env SMTP_USER)
SMTP_PASS=$(read_existing_env SMTP_PASS)
SMTP_FROM=$(read_existing_env SMTP_FROM)

cat > .env <<EOF
APP_DOMAIN=${APP_DOMAIN}
CDN_DOMAIN=${CDN_DOMAIN}
APP_PUBLIC_URL=${APP_PUBLIC_URL}
CDN_PUBLIC_URL=${CDN_PUBLIC_URL}

ADMIN_USERNAME=${ADMIN_USERNAME}
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}

JWT_SECRET=${JWT_SECRET}
LOCAL_SIGN_SECRET=${LOCAL_SIGN_SECRET}

POSTGRES_DB=lumina
POSTGRES_USER=lumina
POSTGRES_PASSWORD=${PG_PASS}
REDIS_PASSWORD=${REDIS_PASS}

LOCAL_STORAGE_PATH=/data/uploads
LOCAL_ENABLED=true

R2_ENABLED=${R2_ENABLED}
R2_ACCOUNT_ID=${R2_ACCOUNT_ID}
R2_ENDPOINT=${R2_ENDPOINT}
R2_BUCKET=${R2_BUCKET}
R2_ACCESS_KEY_ID=${R2_ACCESS_KEY_ID}
R2_SECRET_ACCESS_KEY=${R2_SECRET_ACCESS_KEY}
R2_PUBLIC_URL=${R2_PUBLIC_URL}

SMART_ROUTE_THRESHOLD_MB=5

IMGPROXY_KEY=${IMG_KEY}
IMGPROXY_SALT=${IMG_SALT}

CF_ZONE_ID=
CF_API_TOKEN=
MODERATION_WEBHOOK_URL=
MODERATION_WEBHOOK_SECRET=
UPLOAD_WEBHOOK_URL=
UPLOAD_WEBHOOK_SECRET=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

AI_API_BASE=${AI_API_BASE}
AI_API_KEY=${AI_API_KEY}
AI_MODEL=${AI_MODEL}

SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
SMTP_FROM=${SMTP_FROM}
EOF

mkdir -p data/uploads backups
echo -e "${GREEN}OK${NC} (.env)"

# [5/5] Build & Start Containers
echo ""
echo -e "${CYAN}[5/5] 构建并启动服务...${NC}"
if [ "$DEPLOY_MODE" = "1" ]; then
  docker compose --env-file .env -f deploy/docker-compose.yml up -d --build
else
  docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml up -d --build
fi

for i in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1/api/health" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

echo ""
echo "----------------------------------------"
echo -e "${BOLD}${GREEN}部署完成${NC}"
echo "  URL:      ${APP_PUBLIC_URL}"
echo "  Admin:    ${ADMIN_USERNAME} (${ADMIN_EMAIL})"
echo "  Password: ${ADMIN_PASSWORD}"
echo "  Logs:     make logs"
echo "  Stop:     make down"
echo "  Backup:   make backup-db"
echo "----------------------------------------"
