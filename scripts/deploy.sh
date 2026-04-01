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

# Install deps if lockfile changed
echo "Installing dependencies..." | tee -a "$LOG_FILE"
npm install --legacy-peer-deps 2>&1 | tee -a "$LOG_FILE"

# Stop PM2 before build so it doesn't crash-loop while .next is being rebuilt
echo "Stopping PM2..." | tee -a "$LOG_FILE"
pm2 stop savingkc-crm 2>&1 | tee -a "$LOG_FILE" || true

# Build
echo "Building..." | tee -a "$LOG_FILE"
npm run build 2>&1 | tee -a "$LOG_FILE"

# Start PM2
echo "Starting PM2..." | tee -a "$LOG_FILE"
pm2 start savingkc-crm --update-env 2>&1 | tee -a "$LOG_FILE"

echo "=== Deploy complete: $(date) ===" | tee -a "$LOG_FILE"
