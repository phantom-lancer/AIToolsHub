#!/usr/bin/env bash
# Установка AI Tools Hub на Debian 13. Запускать из клонированного репозитория.
#   git clone https://github.com/phantom-lancer/AIToolsHub.git
#   cd AIToolsHub && chmod +x deploy/install.sh && sudo ./deploy/install.sh
set -euo pipefail

APP_NAME="ai-tools-hub"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_MAJOR="24"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$1"; }

log "1/7 Node.js ${NODE_MAJOR} (нужен 22+, проект использует node:sqlite)"
if ! command -v node >/dev/null 2>&1 || [ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
fi
echo "node $(node --version), npm $(npm --version)"

log "2/7 Ставим зависимости в ${SRC_DIR}"
cd "$SRC_DIR"
rm -rf node_modules
npm ci --omit=dev 2>/dev/null || npm install --omit=dev

log "3/7 Права: процесс будет работать от www-data, БД должна быть доступна на запись"
chown -R www-data:www-data "$SRC_DIR"
# SQLite создаёт database.db рядом с server.js — нужен каталог на запись
chmod 750 "$SRC_DIR"

log "4/7 systemd-юнит"
cat > /etc/systemd/system/${APP_NAME}.service <<UNIT
[Unit]
Description=AI Tools Hub
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=www-data
WorkingDirectory=${SRC_DIR}
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5

# Потолок памяти, чтобы процесс не съел VPS
MemoryMax=512M
LimitNOFILE=8192

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
systemctl enable "${APP_NAME}"
systemctl restart "${APP_NAME}"
sleep 5
systemctl --no-pager --lines=8 status "${APP_NAME}" || true

log "5/7 nginx как reverse proxy на порт 80"
apt-get install -y nginx
cat > /etc/nginx/sites-available/${APP_NAME} <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 4m;

    access_log /var/log/nginx/ai-tools-hub.access.log;
    error_log  /var/log/nginx/ai-tools-hub.error.log;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              \$host;
        proxy_set_header X-Real-IP         \$remote_addr;
        proxy_set_header X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 30s;
    }
}
NGINX

ln -sf /etc/nginx/sites-available/${APP_NAME}" /etc/nginx/sites-enabled/${APP_NAME}
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl reload nginx

log "6/7 Проверка"
sleep 2
if curl -fsS http://127.0.0.1:3000/api/tools > /dev/null; then
    echo "API отвечает — сайт работает."
else
    echo "Не отвечает, логи:"
    journalctl -u "${APP_NAME}" -n 40 --no-pager
    exit 1
fi

IP="$(curl -fsS ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')"
cat <<DONE

────────────────────────────────────────────
Готово. Сайт доступен:

    http://${IP}

Проверить:        curl http://127.0.0.1/api/tools
Логи:            journalctl -u ${APP_NAME} -f
Перезапуск:      sudo systemctl restart ${APP_NAME}
Остановить:      sudo systemctl stop ${APP_NAME}
Проект:           ${SRC_DIR}
База данных:     ${SRC_DIR}/database.db
────────────────────────────────────────────
DONE