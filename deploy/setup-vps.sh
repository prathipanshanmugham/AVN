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
HTTPS_ONLY=1
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
sed "s/__DOMAIN__/$DOMAIN/g" deploy/nginx-avn.conf > /etc/nginx/sites-available/avn
ln -sf /etc/nginx/sites-available/avn /etc/nginx/sites-enabled/avn
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> Firewall"
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable

echo "==> HTTPS certificate (make sure $DOMAIN and www.$DOMAIN point to this server first)"
certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect || \
  echo "!! Certbot failed — check DNS, then run: certbot --nginx -d $DOMAIN -d www.$DOMAIN"

echo "==> Daily backup at 2:30 AM"
( crontab -u "$APP_USER" -l 2>/dev/null | grep -v avn-backup; echo "30 2 * * * cd $APP_DIR && /usr/bin/node scripts/backup.js >> $APP_DIR/data/backup.log 2>&1 # avn-backup" ) | crontab -u "$APP_USER" -

echo
echo "Done. Website: https://$DOMAIN   Staff: https://$DOMAIN/admin   Customers: https://$DOMAIN/portal"
echo "Sign in as 'admin' with the ADMIN_PASSWORD you provided — you'll be asked to set a new one."
