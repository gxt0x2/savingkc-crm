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

# One-time: create system_config table if it doesn't exist
if [ -f "$DEPLOY_DIR/.env.local" ]; then
  SUPABASE_URL=$(grep NEXT_PUBLIC_SUPABASE_URL "$DEPLOY_DIR/.env.local" | cut -d'=' -f2-)
  SERVICE_KEY=$(grep SUPABASE_SERVICE_ROLE_KEY "$DEPLOY_DIR/.env.local" | cut -d'=' -f2-)
  if [ -n "$SUPABASE_URL" ] && [ -n "$SERVICE_KEY" ]; then
    curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/exec_sql" \
      -H "apikey: $SERVICE_KEY" \
      -H "Authorization: Bearer $SERVICE_KEY" \
      -H "Content-Type: application/json" \
      -d '{"sql":"CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())"}' 2>/dev/null || true
    echo "Ensured system_config table exists" | tee -a "$LOG_FILE"
  fi
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
