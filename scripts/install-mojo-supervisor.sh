#!/bin/zsh
set -euo pipefail

if [[ "${1:-}" != "--apply" ]]; then
  echo "Dry run only. Re-run with --apply after reviewing the paths below."
fi

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
NODE_PATH="$(command -v node)"
PLIST_TEMPLATE="$REPO_ROOT/ops/launchd/com.savingkc.mojo-supervised-sync.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/com.savingkc.mojo-supervised-sync.plist"
BACKUP_DIR="$HOME/.openclaw/workspace/memory/backups"
LOG_DIR="$HOME/.openclaw/workspace/memory/logs"

echo "Repository: $REPO_ROOT"
echo "Node: $NODE_PATH"
echo "LaunchAgent: $PLIST_TARGET"
echo "Legacy Mojo cron tags to remove: mojo-crm-sync, mojo-eod-sweep, mojo-session-refresh"
[[ "${1:-}" == "--apply" ]] || exit 0

mkdir -p "$HOME/Library/LaunchAgents" "$BACKUP_DIR" "$LOG_DIR"
CURRENT_CRON="$(mktemp)"
FILTERED_CRON="$(mktemp)"
RENDERED_PLIST="$(mktemp)"
trap 'rm -f "$CURRENT_CRON" "$FILTERED_CRON" "$RENDERED_PLIST"' EXIT

crontab -l > "$CURRENT_CRON" 2>/dev/null || true
BACKUP_PATH="$BACKUP_DIR/crontab-before-mojo-supervisor-$(date +%Y%m%dT%H%M%S).txt"
cp "$CURRENT_CRON" "$BACKUP_PATH"
awk '!/# mojo-crm-sync$/ && !/# mojo-eod-sweep$/ && !/# mojo-session-refresh$/' "$CURRENT_CRON" > "$FILTERED_CRON"
crontab "$FILTERED_CRON"

sed -e "s|__REPO_ROOT__|$REPO_ROOT|g" -e "s|__NODE_PATH__|$NODE_PATH|g" "$PLIST_TEMPLATE" > "$RENDERED_PLIST"
plutil -lint "$RENDERED_PLIST"
install -m 600 "$RENDERED_PLIST" "$PLIST_TARGET"
launchctl bootout "gui/$(id -u)/com.savingkc.mojo-supervised-sync" >/dev/null 2>&1 || true
launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"
launchctl kickstart -k "gui/$(id -u)/com.savingkc.mojo-supervised-sync"

echo "Installed one supervised Mojo runner. Crontab backup: $BACKUP_PATH"
