#!/bin/bash
set -e

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.npm-global/bin:$PATH"

DEPLOY_DIR="$HOME/savingkc-crm"
LOG_FILE="$DEPLOY_DIR/deploy.log"

echo "=== Deploy started: $(date) ===" | tee -a "$LOG_FILE"

cd "$DEPLOY_DIR"

# Pull latest
echo "Pulling latest from main..." | tee -a "$LOG_FILE"
git pull origin main 2>&1 | tee -a "$LOG_FILE"

# One-time: ensure MOJO_PASSWORD in .env.local for recording downloads
if [ -f "$DEPLOY_DIR/.env.local" ]; then
  if ! grep -q "MOJO_PASSWORD" "$DEPLOY_DIR/.env.local"; then
    echo "" >> "$DEPLOY_DIR/.env.local"
    echo "MOJO_PASSWORD=Onlykillerspickupthephoneandmakecalls" >> "$DEPLOY_DIR/.env.local"
    echo "Added MOJO_PASSWORD to .env.local" | tee -a "$LOG_FILE"
  fi
else
  echo ".env.local not found at $DEPLOY_DIR/.env.local — skipping MOJO_PASSWORD injection" | tee -a "$LOG_FILE"
fi

# Install deps from lockfile
echo "Installing dependencies..." | tee -a "$LOG_FILE"
npm ci --legacy-peer-deps 2>&1 | tee -a "$LOG_FILE"

# Build (overwrites .next in place — running server stays up during build)
echo "Building..." | tee -a "$LOG_FILE"
npm run build 2>&1 | tee -a "$LOG_FILE"

# Verify build succeeded
if [ ! -f "$DEPLOY_DIR/.next/BUILD_ID" ]; then
  echo "ERROR: Build failed - no BUILD_ID found!" | tee -a "$LOG_FILE"
  exit 1
fi

# Restart PM2 to pick up new build
echo "Restarting PM2..." | tee -a "$LOG_FILE"
pm2 restart savingkc-crm --update-env 2>&1 | tee -a "$LOG_FILE"

echo "=== Deploy complete: $(date) ===" | tee -a "$LOG_FILE"
