#!/usr/bin/env bash
# Обновление сайта после изменений в коде.
#   cd /opt/ai-tools-hub && git pull && ./deploy/update.sh
set -euo pipefail

APP_NAME="ai-tools-hub"
APP_DIR="/opt/ai-tools-hub"
cd "$APP_DIR"

echo "==> Зависимости"
npm install --omit=dev --no-audit --no-fund

echo "==> Права"
chown -R www-data:www-data "$APP_DIR"

echo "==> Перезапуск"
systemctl restart "${APP_NAME}"
sleep 4

if curl -fsS http://127.0.0.1:3000/api/tools > /dev/null; then
    echo "OK, сайт работает."
else
    echo "Упало, логи:"
    journalctl -u "${APP_NAME}" -n 40 --no-pager
    exit 1
fi