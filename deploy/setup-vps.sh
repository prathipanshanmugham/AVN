#!/usr/bin/env bash
# One-time setup of AVN on a Hostinger VPS (Ubuntu 22.04 / 24.04). Safe on a server that already hosts
# other sites: it adds its own Nginx site, picks a free port and does not touch other apps. Run as root:
#
#   DOMAIN=avnsolar.in ADMIN_PASSWORD='first-admin-password' \
#   REPO="https://<github-user>:<token>@github.com/prathipanshanmugham/AVN.git" bash setup-vps.sh
#
# DOMAIN can also be the server's IP address (plain HTTP) until the domain points here.
set -euo pipefail

DOMAIN="${DOMAIN:-avnsolar.in}"
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD for the first admin login}"
REPO="${REPO:-https://github.com/prathipanshanmugham/AVN.git}"
APP_DIR=/var/www/avn
APP_USER=avn

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl git nginx ffmpeg certbot python3-certbot-nginx build-essential

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  echo "==> Installing Node.js 22 (other Node apps on this server will also use Node 22 after their next restart)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
command -v pm2 >/dev/null || npm install -g pm2

echo "==> Creating app user and folder"
id -u "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash "$APP_USER"
mkdir -p "$APP_DIR"
chown "$APP_USER":"$APP_USER" "$APP_DIR"

echo "==> Getting the code"
if [ ! -d "$APP_DIR/.git" ]; then
  sudo -u "$APP_USER" git clone "$REPO" "$APP_DIR"
else
  sudo -u "$APP_USER" git -C "$APP_DIR" pull --ff-only
fi
cd "$APP_DIR"
sudo -u "$APP_USER" npm ci --omit=dev

if [ ! -f .env ]; then
  # First free port from 3000 up, so we never collide with another app on this server.
  PORT="${PORT:-3000}"
  while ss -ltnH "( sport = :$PORT )" | grep -q .; do PORT=$((PORT + 1)); done
  echo "==> Writing .env (app port $PORT)"
  cat > .env <<EOF
NODE_ENV=production
PORT=$PORT
HOST=127.0.0.1
HTTPS_ONLY=0
SESSION_SECRET=$(openssl rand -hex 32)
ADMIN_USERNAME=admin
ADMIN_PASSWORD=$ADMIN_PASSWORD
DATA_DIR=data
UPLOAD_DIR=uploads
EOF
  chown "$APP_USER":"$APP_USER" .env
  chmod 600 .env
fi
sudo -u "$APP_USER" mkdir -p data/logs uploads

echo "==> Starting the app with PM2 (runs as user $APP_USER, separate from any root PM2 apps)"
if sudo -u "$APP_USER" pm2 describe avn >/dev/null 2>&1; then
  sudo -u "$APP_USER" pm2 reload avn --update-env
else
  sudo -u "$APP_USER" pm2 start deploy/ecosystem.config.cjs
fi
sudo -u "$APP_USER" pm2 save
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

echo "==> Firewall"
if ufw status | grep -q "Status: active"; then
  ufw allow OpenSSH >/dev/null
  ufw allow 'Nginx Full' >/dev/null
else
  echo "   ufw is not active — leaving it as it is."
fi

bash "$APP_DIR/deploy/set-domain.sh" "$DOMAIN"

echo "==> Daily backup at 2:30 AM"
( crontab -u "$APP_USER" -l 2>/dev/null | grep -v avn-backup; echo "30 2 * * * cd $APP_DIR && /usr/bin/node scripts/backup.js >> $APP_DIR/data/backup.log 2>&1 # avn-backup" ) | crontab -u "$APP_USER" -

echo
echo "Sign in at /admin as 'admin' with the ADMIN_PASSWORD you provided — you'll be asked to set a new one."
