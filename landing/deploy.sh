#!/bin/bash
# deploy.sh — Build and deploy RLD landing to demo.rld.fi
# Usage: bash deploy.sh
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "→ Installing dependencies..."
npm ci

echo "→ Building..."
npm run build

echo "→ Copying nginx config..."
sudo cp nginx.conf /etc/nginx/sites-available/demo.rld.fi
sudo ln -sf /etc/nginx/sites-available/demo.rld.fi /etc/nginx/sites-enabled/demo.rld.fi

echo "→ Testing nginx config..."
sudo nginx -t

echo "→ Reloading nginx..."
sudo systemctl reload nginx

echo "✓ demo.rld.fi deployed from dist/"
echo ""
echo "  If first deploy, run SSL cert:"
echo "  sudo certbot --nginx -d demo.rld.fi"
