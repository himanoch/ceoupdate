#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-/home/youruser/chatto-bot}"
APP_PORT="${APP_PORT:-3000}"
NODE_ENV="${NODE_ENV:-production}"

mkdir -p "$APP_DIR"
cd "$APP_DIR"

if [ -f package.json ]; then
  echo "[deploy] Installing production dependencies..."
  npm install --production
else
  echo "[deploy] package.json not found. Please upload the project first."
  exit 1
fi

if command -v pm2 >/dev/null 2>&1; then
  echo "[deploy] Restarting app with PM2..."
  pm2 start "npm run start" --name chatto-bot --env "$NODE_ENV" || pm2 restart chatto-bot
else
  echo "[deploy] PM2 not installed. Start the app manually with:"
  echo "  PORT=$APP_PORT NODE_ENV=$NODE_ENV npm run start"
fi

echo "[deploy] Deployment complete."
