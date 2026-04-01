#!/bin/bash
set -e

DEPLOY_DIR="$HOME/savingkc-crm"
LOG_FILE="$DEPLOY_DIR/deploy.log"

echo "=== Deploy started: $(date) ===" | tee -a "$LOG_FILE"

cd "$DEPLOY_DIR"

# Pull latest
echo "Pulling latest from main..." | tee -a "$LOG_FILE"
git pull origin main 2>&1 | tee -a "$LOG_FILE"

# Install deps if lockfile changed
echo "Installing dependencies..." | tee -a "$LOG_FILE"
npm install --production=false 2>&1 | tee -a "$LOG_FILE"

# Build
echo "Building..." | tee -a "$LOG_FILE"
npm run build 2>&1 | tee -a "$LOG_FILE"

# Restart
echo "Restarting PM2..." | tee -a "$LOG_FILE"
pm2 restart savingkc-crm --update-env 2>&1 | tee -a "$LOG_FILE"

echo "=== Deploy complete: $(date) ===" | tee -a "$LOG_FILE"
