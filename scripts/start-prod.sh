#!/usr/bin/env bash
# Production helpers for VPS (Ubuntu/Debian). Run from project root.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cmd="${1:-help}"

case "$cmd" in
  install)
    npm ci
    ;;
  build)
    npm run build
    ;;
  serve-static)
    DEST="${2:-/var/www/agarwa}"
    echo "Copying dist/ → $DEST"
    sudo mkdir -p "$DEST"
    sudo rsync -a --delete dist/ "$DEST/"
    echo "Done. Point nginx root to $DEST"
    ;;
  pm2)
    npx pm2 start ecosystem.config.cjs
    npx pm2 save
    echo "PM2 started. Useful: pm2 status | pm2 logs agarwa-server | pm2 restart agarwa-server"
    ;;
  docker)
    docker compose up -d --build game-server
    ;;
  help|*)
    cat <<'EOF'
Usage: scripts/start-prod.sh <command>

  install       npm ci
  build         npm run build (client → dist/)
  serve-static [dir]   copy dist/ to nginx root (default /var/www/agarwa)
  pm2           start WS server via PM2
  docker        start WS server via docker compose

See DEPLOY.md for full Timeweb/Reg.ru steps.
EOF
    ;;
esac
