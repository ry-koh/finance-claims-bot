#!/bin/bash
# One-time server setup for Oracle Cloud ARM Ubuntu 22.04
# Run as: sudo bash setup.sh YOUR_DOMAIN
# Example: sudo bash setup.sh finance-api.duckdns.org
set -e

DOMAIN="${1:?Usage: sudo bash setup.sh YOUR_DOMAIN}"
APP_DIR="/opt/finance-claims-bot"
SERVICE_USER="ubuntu"

echo "=== Setting up Finance Claims Bot on $DOMAIN ==="

# ── System packages ────────────────────────────────────────────────────────
echo "[1/7] Installing system packages..."
apt-get update -qq
apt-get install -y -qq \
    software-properties-common curl git nginx certbot python3-certbot-nginx \
    python3-pip python3-venv build-essential

# Python 3.12 via deadsnakes PPA
add-apt-repository -y ppa:deadsnakes/ppa
apt-get update -qq
apt-get install -y -qq python3.12 python3.12-venv python3.12-dev

# ── Firewall ───────────────────────────────────────────────────────────────
echo "[2/7] Configuring firewall..."
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

# ── App directory ──────────────────────────────────────────────────────────
echo "[3/7] Cloning repository..."
if [ ! -d "$APP_DIR/.git" ]; then
    git clone https://github.com/$(git -C /tmp ls-remote --get-url 2>/dev/null || echo "OWNER/REPO") "$APP_DIR" 2>/dev/null || true
fi
# If clone failed (no remote set yet), just ensure directory exists
mkdir -p "$APP_DIR/backend"
chown -R "$SERVICE_USER:$SERVICE_USER" "$APP_DIR"

# ── Python virtualenv ──────────────────────────────────────────────────────
echo "[4/7] Creating Python virtualenv..."
sudo -u "$SERVICE_USER" python3.12 -m venv "$APP_DIR/backend/venv"
sudo -u "$SERVICE_USER" "$APP_DIR/backend/venv/bin/pip" install --upgrade pip -q

# ── Nginx config ───────────────────────────────────────────────────────────
echo "[5/7] Configuring nginx..."
cat > /etc/nginx/sites-available/finance-claims-bot << NGINX
server {
    listen 80;
    server_name $DOMAIN;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
    }

    client_max_body_size 20M;
}
NGINX

ln -sf /etc/nginx/sites-available/finance-claims-bot /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# ── SSL certificate ────────────────────────────────────────────────────────
echo "[6/7] Obtaining SSL certificate..."
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m admin@"$DOMAIN" --redirect

# ── systemd service ────────────────────────────────────────────────────────
echo "[7/7] Installing systemd service..."
cat > /etc/systemd/system/finance-claims-bot.service << SERVICE
[Unit]
Description=Finance Claims Bot API
After=network.target

[Service]
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$APP_DIR/backend
EnvironmentFile=/etc/finance-claims-bot.env
ExecStart=$APP_DIR/backend/venv/bin/uvicorn app.main:app \
    --host 127.0.0.1 \
    --port 8000 \
    --workers 1 \
    --limit-max-requests 200 \
    --log-level info
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable finance-claims-bot

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "  1. Create /etc/finance-claims-bot.env with your environment variables"
echo "     (copy from backend/.env.example and fill in all values)"
echo "     APP_URL should be: https://$DOMAIN"
echo ""
echo "  2. Deploy the app:"
echo "     cd $APP_DIR && git pull"
echo "     ./backend/venv/bin/pip install -r backend/requirements.txt"
echo "     sudo systemctl start finance-claims-bot"
echo ""
echo "  3. Check status:"
echo "     sudo systemctl status finance-claims-bot"
echo "     sudo journalctl -u finance-claims-bot -f"
