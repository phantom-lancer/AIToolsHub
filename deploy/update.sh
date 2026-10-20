#!/usr/bin/env bash
# Обновление сайта после изменений в коде.
#   cd /opt/ai-tools-hub && bash deploy/update.sh
# Скрипт сам тянет изменения из GitHub, ставит зависимости и перезапускает сервис.
set -euo pipefail

APP_NAME="ai-tools-hub"
APP_DIR="/opt/ai-tools-hub"
cd "$APP_DIR"

# Каталог принадлежит www-data, а git запускается от root — без этой строки
# git откажется работать ("detected dubious ownership").
git config --global --add safe.directory "$APP_DIR" 2>/dev/null || true

echo "==> Забираем изменения"
git pull --ff-only

echo "==> Зависимости"
npm install --omit=dev --no-audit --no-fund

echo "==> Права"
chown -R www-data:www-data "$APP_DIR"

echo "==> Перезапуск"
systemctl restart "${APP_NAME}"
sleep 5

if curl -fsS http://127.0.0.1:3000/api/tools > /dev/null; then
    echo "OK, сайт работает."
else
    echo "Упало, логи:"
    journalctl -u "${APP_NAME}" -n 40 --no-pager
    exit 1
fi

echo "==> Проверка новых страниц"
for path in / /tool/1 /sitemap.xml /robots.txt; do
    code="$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:3000${path}")"
    echo "    ${path} => ${code}"
done