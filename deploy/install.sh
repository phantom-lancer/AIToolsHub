#!/usr/bin/env bash
# Установка AI Tools Hub на Debian 13 (VPS). Запускать от root или через sudo.
set -euo pipefail

APP_NAME="ai-tools-hub"
APP_DIR="/var/www/ai-tools-hub"
APP_USER="www-data"
NODE_MAJOR="24"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

log "1/7 Node.js ${NODE_MAJOR} (нужен 22+, проект использует node:sqlite)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
fi
node --version
npm --version

log "2/7 Копируем проект в ${APP_DIR}"
mkdir -p "$APP_DIR"
# Скрипт должен лежать рядом с ним
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
    rsync -a --delete \
        --exclude 'node_modules' \
        --exclude 'database.db*' \
        --exclude '.git' \
        --exclude '_preview' \
        "$SRC_DIR/" "$APP_DIR/"
fi
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "3/7 Зависимости"
cd "$APP_DIR"
npm ci --omit=dev || npm install --omit=dev

log "4/7 Права на каталог данных"
# SQLite пишет файл БД рядом с server.js — каталог должен быть доступен на запись
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
chmod 750 "$APP_DIR"

log "5/7 systemd-юнит"
cat > /etc/systemd/system/${APP_NAME}.service <<UNIT
[Unit]
Description=AI Tools Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${APP_USER}
WorkingDirectory=${APP_DIR}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

# Немного ограничений, чтобы процесс не съел VPS
MemoryMax=512M
LimitNOFILE=8192

# Минимальные права
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

StandardOutput=journal
StandardError=journal
SyslogIdentifier=${APP_NAME}

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable ${APP_NAME}
systemctl restart ${APP_NAME}
sleep 4
systemctl --no-pager --lines=10 status ${APP_NAME} || true

log "6/7 nginx как reverse proxy на 80/443"
apt-get install -y nginx
cat > /etc/nginx/sites-available/${APP_NAME} <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name _;

    # Ограничение размера — пригодится для загрузки аватаров
    client_max_body_size 4m;

    access_log /var/log/nginx/ai-tools-hub.access.log;
    error_log  /var/log/nginx/ai-tools-hub.error.log;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 30s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/${APP_NAME} /etc/nginx/sites-enabled/${APP_NAME}
# Убираем дефолтный сайт, иначе он перехватит /
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "7/7 Проверка"
sleep 2
if curl -fsS http://127.0.0.1:3000/api/tools > /dev/null; then
    echo "API отвечает, всё работает."
else
    echo "Что-то не так, смотрите логи:"
    journalctl -u ${APP_NAME} -n 40 --no-pager
    exit 1
fi

cat <<DONE

────────────────────────────────────────────
Готово. Сайт доступен по IP этого сервера:

    http://$(curl -fsS ifconfig.me 2>/dev/null || echo 'IP-СЕРВЕРА')

Логи:            journalctl -u ${APP_NAME} -f
Перезапуск:      systemctl restart ${APP_NAME}
Остановить:      systemctl stop ${APP_NAME}
Файлы проекта:   ${APP_DIR}
База данных:     ${APP_DIR}/database.db
────────────────────────────────────────────
DONE