#!/bin/bash
# Auto-deploy: checks for new commits on main and deploys if found
# Run via cron every minute: * * * * * /path/to/auto-deploy.sh

export PATH="/usr/local/bin:/opt/homebrew/bin:$HOME/.npm-global/bin:$PATH"

DEPLOY_DIR="$HOME/savingkc-crm"
LOCK_FILE="/tmp/savingkc-deploy.lock"
LOG_FILE="$DEPLOY_DIR/deploy.log"

# Prevent concurrent deploys
if [ -f "$LOCK_FILE" ]; then
  LOCK_AGE=$(( $(date +%s) - $(stat -f %m "$LOCK_FILE") ))
  if [ "$LOCK_AGE" -lt 300 ]; then
    exit 0  # Deploy in progress (< 5 min old)
  fi
  rm -f "$LOCK_FILE"  # Stale lock
fi

cd "$DEPLOY_DIR"

# Fetch and check for new commits
git fetch origin main 2>/dev/null
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)

if [ "$LOCAL" = "$REMOTE" ]; then
  exit 0  # Already up to date
fi

# New commits found — deploy
touch "$LOCK_FILE"
echo "=== Deploy started: $(date) ===" | tee -a "$LOG_FILE"
echo "Updating $LOCAL -> $REMOTE" | tee -a "$LOG_FILE"

# Pull
git pull origin main 2>&1 | tee -a "$LOG_FILE"

# Install deps
npm ci --legacy-peer-deps 2>&1 | tee -a "$LOG_FILE"

# Build
npm run build 2>&1 | tee -a "$LOG_FILE"

# Verify build
if [ ! -f "$DEPLOY_DIR/.next/BUILD_ID" ]; then
  echo "ERROR: Build failed!" | tee -a "$LOG_FILE"
  rm -f "$LOCK_FILE"
  exit 1
fi

# Restart
pm2 restart savingkc-crm --update-env 2>&1 | tee -a "$LOG_FILE"

echo "=== Deploy complete: $(date) ===" | tee -a "$LOG_FILE"
rm -f "$LOCK_FILE"
