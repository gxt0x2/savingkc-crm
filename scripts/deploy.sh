#!/bin/bash
set -e

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.npm-global/bin:$PATH"

DEPLOY_DIR="$HOME/savingkc-crm"
LOG_FILE="$DEPLOY_DIR/deploy.log"

echo "=== Deploy started: $(date) ===" | tee -a "$LOG_FILE"

cd "$DEPLOY_DIR"

# Stop PM2 first so it doesn't crash-loop while .next is missing
echo "Stopping PM2..." | tee -a "$LOG_FILE"
pm2 stop savingkc-crm 2>&1 | tee -a "$LOG_FILE" || true

# Pull latest
echo "Pulling latest from main..." | tee -a "$LOG_FILE"
git pull origin main 2>&1 | tee -a "$LOG_FILE"

# Clean build cache
rm -rf .next

# Install deps from lockfile (exact versions)
echo "Installing dependencies..." | tee -a "$LOG_FILE"
npm ci --legacy-peer-deps 2>&1 | tee -a "$LOG_FILE"

# Build
echo "Building..." | tee -a "$LOG_FILE"
npm run build 2>&1 | tee -a "$LOG_FILE"

# Verify build succeeded
if [ ! -f "$DEPLOY_DIR/.next/BUILD_ID" ]; then
  echo "ERROR: Build failed - no BUILD_ID found!" | tee -a "$LOG_FILE"
  echo "Attempting to start PM2 with previous build..." | tee -a "$LOG_FILE"
  pm2 start savingkc-crm --update-env 2>&1 | tee -a "$LOG_FILE" || true
  exit 1
fi

# Start PM2
echo "Starting PM2..." | tee -a "$LOG_FILE"
pm2 start savingkc-crm --update-env 2>&1 | tee -a "$LOG_FILE"

echo "=== Deploy complete: $(date) ===" | tee -a "$LOG_FILE"
