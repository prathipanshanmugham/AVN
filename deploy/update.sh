#!/usr/bin/env bash
# Pull the latest code and restart without downtime. Run as root or the avn user:  bash /var/www/avn/deploy/update.sh
set -euo pipefail
cd /var/www/avn
sudo -u avn git pull --ff-only
sudo -u avn npm ci --omit=dev
sudo -u avn pm2 reload avn
echo "Updated to $(git log -1 --format='%h %s')"
