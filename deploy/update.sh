#!/usr/bin/env bash
# Обновление сайта на VPS после изменений в коде.
# На сервере: cd /var/www/ai-tools-hub && ./deploy/update.sh
set -euo pipefail

APP_DIR="/var/www/ai-tools-hub"
cd "$APP_DIR"

echo "==> Ставим зависимости"
npm install --omit=dev

echo "==> Перезапускаем"
systemctl restart ai-tools-hub
sleep 3

if curl -fsS http://127.0.0.1:3000/api/tools > /dev/null; then
    echo "OK, сайт работает."
else
    echo "Упало, логи:"
    journalctl -u ai-tools-hub -n 40 --no-pager
    exit 1
fi