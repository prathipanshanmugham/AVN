#!/usr/bin/env bash
# One-time setup of AVN on a fresh Hostinger VPS (Ubuntu 22.04 / 24.04). Run as root:
#
#   DOMAIN=avnsolar.in ADMIN_PASSWORD='your-first-admin-password' \
#   REPO=https://github.com/prathipanshanmugham/avn.git bash setup-vps.sh
#
# For a private repo, use a URL with a GitHub token or set up a deploy key first, e.g.
#   REPO=https://<github-username>:<personal-access-token>@github.com/prathipanshanmugham/avn.git
set -euo pipefail

: "${DOMAIN:?Set DOMAIN, e.g. DOMAIN=avnsolar.in}"
: "${ADMIN_PASSWORD:?Set ADMIN_PASSWORD for the first admin login}"
REPO="${REPO:-https://github.com/prathipanshanmugham/avn.git}"
APP_DIR=/var/www/avn
IS_IP=0
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then IS_IP=1; fi
APP_USER=avn
EMAIL="${EMAIL:-admin@$DOMAIN}"

echo "==> Installing system packages"
apt-get update -y
apt-get install -y curl git nginx ffmpeg ufw certbot python3-certbot-nginx build-essential

if ! command -v node >/dev/null || [ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]; then
  echo "==> Installing Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
npm install -g pm2

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
  echo "==> Writing .env"
  cat > .env <<EOF
NODE_ENV=production
PORT=3000
HOST=127.0.0.1
HTTPS_ONLY=$([ "$IS_IP" = 1 ] && echo 0 || echo 1)
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

echo "==> Starting the app with PM2"
sudo -u "$APP_USER" pm2 start deploy/ecosystem.config.cjs
sudo -u "$APP_USER" pm2 save
env PATH="$PATH" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" >/dev/null

echo "==> Configuring Nginx for $DOMAIN"
if [ "$IS_IP" = 1 ]; then
  sed "s/server_name __DOMAIN__ www.__DOMAIN__;/server_name $DOMAIN _;/" deploy/nginx-avn.conf > /etc/nginx/sites-available/avn
else
  sed "s/__DOMAIN__/$DOMAIN/g" deploy/nginx-avn.conf > /etc/nginx/sites-available/avn
fi
ln -sf /etc/nginx/sites-available/avn /etc/nginx/sites-enabled/avn
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

if [ "$IS_IP" = 1 ]; then
  echo "==> Running on the IP address over plain HTTP. Re-run this script with DOMAIN=yourdomain once DNS points here to get HTTPS."
else
  echo "==> HTTPS certificate (make sure $DOMAIN and www.$DOMAIN point to this server first)"
  if ! certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
    echo "!! Certbot failed — the site runs on plain HTTP for now."
    echo "   Fix DNS, then run: certbot --nginx -d $DOMAIN -d www.$DOMAIN && sed -i 's/^HTTPS_ONLY=0/HTTPS_ONLY=1/' $APP_DIR/.env && sudo -u $APP_USER pm2 restart avn"
    sed -i 's/^HTTPS_ONLY=1/HTTPS_ONLY=0/' .env
    sudo -u "$APP_USER" pm2 restart avn
  elif grep -q '^HTTPS_ONLY=0' .env; then
    sed -i 's/^HTTPS_ONLY=0/HTTPS_ONLY=1/' .env
    sudo -u "$APP_USER" pm2 restart avn
  fi
fi

echo "==> Daily backup at 2:30 AM"
( crontab -u "$APP_USER" -l 2>/dev/null | grep -v avn-backup; echo "30 2 * * * cd $APP_DIR && /usr/bin/node scripts/backup.js >> $APP_DIR/data/backup.log 2>&1 # avn-backup" ) | crontab -u "$APP_USER" -

echo
SCHEME=$(grep -q '^HTTPS_ONLY=1' .env && echo https || echo http)
echo "Done. Website: $SCHEME://$DOMAIN   Staff: $SCHEME://$DOMAIN/admin   Customers: $SCHEME://$DOMAIN/portal"
echo "Sign in as 'admin' with the ADMIN_PASSWORD you provided — you'll be asked to set a new one."
