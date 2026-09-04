#!/bin/zsh
set -euo pipefail

if [[ "${1:-}" != "--apply" ]]; then
  echo "Dry run only. Re-run with --apply after reviewing the paths below."
fi

SCRIPT_DIR="${0:A:h}"
REPO_ROOT="${SCRIPT_DIR:h}"
NODE_PATH="$(command -v node)"
NPM_PATH="$(command -v npm)"
RUNTIME_ROOT="${MOJO_RUNTIME_ROOT:-$HOME/.local/share/savingkc-mojo-supervisor}"
RUNTIME_PARENT="${RUNTIME_ROOT:h}"
PLIST_TEMPLATE="$REPO_ROOT/ops/launchd/com.savingkc.mojo-supervised-sync.plist"
PLIST_TARGET="$HOME/Library/LaunchAgents/com.savingkc.mojo-supervised-sync.plist"
BACKUP_DIR="$HOME/.openclaw/workspace/memory/backups"
LOG_DIR="$HOME/.openclaw/workspace/memory/logs"

echo "Repository: $REPO_ROOT"
echo "Node: $NODE_PATH"
echo "Runtime: $RUNTIME_ROOT"
echo "LaunchAgent: $PLIST_TARGET"
echo "Legacy Mojo cron tags to remove: mojo-crm-sync, mojo-eod-sweep, mojo-session-refresh"
[[ "${1:-}" == "--apply" ]] || exit 0

mkdir -p "$HOME/Library/LaunchAgents" "$BACKUP_DIR" "$LOG_DIR" "$RUNTIME_PARENT"
CURRENT_CRON="$(mktemp)"
FILTERED_CRON="$(mktemp)"
RENDERED_PLIST="$(mktemp)"
STAGING_DIR="$(mktemp -d "$RUNTIME_PARENT/mojo-supervisor-stage.XXXXXX")"
cleanup() {
  rm -f "$CURRENT_CRON" "$FILTERED_CRON" "$RENDERED_PLIST"
  if [[ -n "${STAGING_DIR:-}" && -d "$STAGING_DIR" ]]; then
    find "$STAGING_DIR" -depth -delete
  fi
}
trap cleanup EXIT

mkdir -p "$STAGING_DIR/scripts"
RUNTIME_SCRIPTS=(
  mojo-supervised-runner.mjs
  mojo-cron-runner.mjs
  mojo-extract-session.mjs
  mojo-session-health.mjs
  mojo-sync.mjs
  mojo-kpi-snapshot.mjs
  mojo-eod-sweep.mjs
)
for script_name in "${RUNTIME_SCRIPTS[@]}"; do
  install -m 700 "$REPO_ROOT/scripts/$script_name" "$STAGING_DIR/scripts/$script_name"
done

"$NPM_PATH" install --prefix "$STAGING_DIR" --no-package-lock --no-save --omit=dev playwright-core@1.60.0
(
  cd "$STAGING_DIR"
  "$NODE_PATH" -e "import('playwright-core').then(() => console.log('playwright-core runtime verified'))"
  "$NODE_PATH" --check scripts/mojo-supervised-runner.mjs
  "$NODE_PATH" --check scripts/mojo-cron-runner.mjs
)

if [[ -f "$RUNTIME_ROOT/.env.local" ]]; then
  install -m 600 "$RUNTIME_ROOT/.env.local" "$STAGING_DIR/.env.local"
fi

crontab -l > "$CURRENT_CRON" 2>/dev/null || true
BACKUP_PATH="$BACKUP_DIR/crontab-before-mojo-supervisor-$(date +%Y%m%dT%H%M%S).txt"
cp "$CURRENT_CRON" "$BACKUP_PATH"
awk '!/# mojo-crm-sync$/ && !/# mojo-eod-sweep$/ && !/# mojo-session-refresh$/' "$CURRENT_CRON" > "$FILTERED_CRON"
crontab "$FILTERED_CRON"

sed -e "s|__REPO_ROOT__|$RUNTIME_ROOT|g" -e "s|__NODE_PATH__|$NODE_PATH|g" "$PLIST_TEMPLATE" > "$RENDERED_PLIST"
plutil -lint "$RENDERED_PLIST"
launchctl bootout "gui/$(id -u)/com.savingkc.mojo-supervised-sync" >/dev/null 2>&1 || true

RUNTIME_BACKUP=""
if [[ -d "$RUNTIME_ROOT" ]]; then
  RUNTIME_BACKUP="$BACKUP_DIR/mojo-supervisor-runtime-$(date +%Y%m%dT%H%M%S)"
  mv "$RUNTIME_ROOT" "$RUNTIME_BACKUP"
fi
mv "$STAGING_DIR" "$RUNTIME_ROOT"
STAGING_DIR=""
install -m 600 "$RENDERED_PLIST" "$PLIST_TARGET"
if ! launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET"; then
  echo "LaunchAgent activation failed; restoring the prior runtime." >&2
  if [[ -n "$RUNTIME_BACKUP" && -d "$RUNTIME_BACKUP" ]]; then
    FAILED_RUNTIME="$BACKUP_DIR/mojo-supervisor-runtime-failed-$(date +%Y%m%dT%H%M%S)"
    mv "$RUNTIME_ROOT" "$FAILED_RUNTIME"
    mv "$RUNTIME_BACKUP" "$RUNTIME_ROOT"
    RUNTIME_BACKUP=""
    launchctl bootstrap "gui/$(id -u)" "$PLIST_TARGET" || true
  fi
  exit 1
fi
launchctl kickstart -k "gui/$(id -u)/com.savingkc.mojo-supervised-sync"

echo "Installed one self-contained supervised Mojo runner. Crontab backup: $BACKUP_PATH"
[[ -z "$RUNTIME_BACKUP" ]] || echo "Previous runtime backup: $RUNTIME_BACKUP"
