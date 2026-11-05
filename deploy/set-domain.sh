#!/usr/bin/env bash
# Point AVN at a domain (gets a free HTTPS certificate) or at the server IP (plain HTTP). Run as root:
#
#   bash /var/www/avn/deploy/set-domain.sh avnsolar.in
#   bash /var/www/avn/deploy/set-domain.sh 123.45.67.89
#
# Only touches AVN's own Nginx site (/etc/nginx/sites-available/avn); other sites on the server are left alone.
set -euo pipefail

DOMAIN="${1:-avnsolar.in}"
APP_DIR=/var/www/avn
APP_USER=avn
CONF=/etc/nginx/sites-available/avn
EMAIL="${EMAIL:-admin@$DOMAIN}"
PORT=$(grep -E '^PORT=' "$APP_DIR/.env" 2>/dev/null | cut -d= -f2 || true)
PORT="${PORT:-3000}"

IS_IP=0
if [[ "$DOMAIN" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then IS_IP=1; fi
NAMES="$DOMAIN www.$DOMAIN"
[ "$IS_IP" = 1 ] && NAMES="$DOMAIN"

echo "==> Nginx: $NAMES -> 127.0.0.1:$PORT"
sed -e "s/server_name __DOMAIN__ www.__DOMAIN__;/server_name $NAMES;/" \
    -e "s/127.0.0.1:3000/127.0.0.1:$PORT/" \
    "$APP_DIR/deploy/nginx-avn.conf" > "$CONF"
ln -sf "$CONF" /etc/nginx/sites-enabled/avn
nginx -t
systemctl reload nginx

set_https() {
  sed -i "s/^HTTPS_ONLY=.*/HTTPS_ONLY=$1/" "$APP_DIR/.env"
  sudo -u "$APP_USER" pm2 restart avn --update-env >/dev/null
}

if [ "$IS_IP" = 1 ]; then
  set_https 0
  echo "Done: http://$DOMAIN  (staff: http://$DOMAIN/admin)"
  exit 0
fi

echo "==> HTTPS certificate for $DOMAIN and www.$DOMAIN"
if certbot --nginx -d "$DOMAIN" -d "www.$DOMAIN" --non-interactive --agree-tos -m "$EMAIL" --redirect; then
  set_https 1
  echo "Done: https://$DOMAIN  (staff: https://$DOMAIN/admin)"
else
  set_https 0
  echo "!! Could not get a certificate. Check that $DOMAIN and www.$DOMAIN have A records pointing to this server,"
  echo "   wait for DNS to update, then run this script again. The site works on http://$DOMAIN meanwhile."
fi
