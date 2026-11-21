#!/usr/bin/env bash
set -euo pipefail

if [ -f .env ]; then
  echo "⚠️  .env 文件已存在，跳过初始化。如需重新生成请先备份并删除 .env。"
  exit 0
fi

cp .env.example .env

gen_hex() {
  openssl rand -hex "$1" 2>/dev/null || head -c "$1" /dev/urandom | od -An -tx1 | tr -d ' \n'
}

JWT_SECRET=$(gen_hex 32)
LOCAL_SIGN_SECRET=$(gen_hex 32)
PG_PASS=$(gen_hex 16)
REDIS_PASS=$(gen_hex 16)
IMG_KEY=$(gen_hex 32)
IMG_SALT=$(gen_hex 32)

sed -i.bak "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" .env
sed -i.bak "s|^LOCAL_SIGN_SECRET=.*|LOCAL_SIGN_SECRET=${LOCAL_SIGN_SECRET}|" .env
sed -i.bak "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" .env
sed -i.bak "s|^REDIS_PASSWORD=.*|REDIS_PASSWORD=${REDIS_PASS}|" .env
sed -i.bak "s|^IMGPROXY_KEY=.*|IMGPROXY_KEY=${IMG_KEY}|" .env
sed -i.bak "s|^IMGPROXY_SALT=.*|IMGPROXY_SALT=${IMG_SALT}|" .env
rm -f .env.bak

mkdir -p data/uploads

echo "✅ 已生成安全随机密钥并写入 .env，同时创建了 data/uploads 本地存储目录。"
echo "👉 下一步请编辑 .env 中的 APP_DOMAIN / CDN_DOMAIN / ADMIN_PASSWORD 及 R2 密钥（可选）："
echo "   nano .env"
echo "👉 生产 HTTPS 启动: docker compose --env-file .env -f deploy/docker-compose.yml up -d --build"
echo "👉 无域名 IP 体验:  docker compose --env-file .env -f deploy/docker-compose.yml -f deploy/docker-compose.local.yml up -d --build"
