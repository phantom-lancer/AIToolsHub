#!/usr/bin/env bash
# Ставит туннель Cloudflare как systemd-сервис, чтобы он не умирал
# вместе с окном консоли и поднимался после перезагрузки сервера.
set -euo pipefail

BIN=/usr/local/bin/cloudflared
SVC=tunnel
STATE=/var/lib/tunnel

if [ ! -x "$BIN" ]; then
    echo "Качаю cloudflared..."
    curl -fL --progress-bar -o "$BIN" \
        https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64
    chmod +x "$BIN"
fi

mkdir -p "$STATE"

cat > /etc/systemd/system/${SVC}.service <<UNIT
[Unit]
Description=Публичный туннель к сайту (Cloudflare)
After=network-online.target ai-tools-hub.service
Wants=network-online.target
Requires=ai-tools-hub.service

[Service]
Type=simple
ExecStart=${BIN} tunnel --url http://127.0.0.1:3000 --no-autoupdate --protocol http2
Restart=always
RestartSec=10
StartLimitIntervalSec=0

# Адрес туннеля каждый раз новый — пишем его в файл, чтобы можно было прочитать
StandardOutput=append:${STATE}/tunnel.log
StandardError=append:${STATE}/tunnel.log

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable "${SVC}"
systemctl restart "${SVC}"

echo "Жду адрес..."
for i in $(seq 1 30); do
    URL="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "${STATE}/tunnel.log" 2>/dev/null | tail -1 || true)"
    if [ -n "$URL" ]; then
        echo "ТУННЕЛЬ ЖИВ"
        echo "$URL"
        exit 0
    fi
    sleep 2
done

echo "Адрес не появился за минуту. Смотри лог:"
tail -n 30 "${STATE}/tunnel.log"
exit 1