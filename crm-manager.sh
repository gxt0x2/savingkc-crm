#!/bin/bash
# Saving KC CRM Manager Script
#
# Port 3002 is shared ground. pm2's `savingkc-crm` process serves it from a
# different checkout (savingkc-crm-ppc-sell), and this script is launched at
# boot by the com.savingkc.crm LaunchAgent. So "is the CRM running?" cannot be
# answered from a recorded pid alone: the authority is the port, plus the
# working directory of whoever holds it. Every guard below works that way, and
# nothing is killed unless it is provably a server started from THIS checkout.

CRM_DIR="/Users/ernestdodson/savingkc-crm"
PID_FILE="$CRM_DIR/.crm.pid"
LOG_DIR="$CRM_DIR/logs"
PORT=3002

cd "$CRM_DIR" || exit 1

get_pid() {
  if [ -f "$PID_FILE" ]; then
    cat "$PID_FILE"
  fi
}

# The pid listening on our port, whoever started it.
port_listener() {
  lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null | head -1
}

# A pid's working directory — how we tell our server from another checkout's.
pid_cwd() {
  [ -n "$1" ] || return 1
  lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | head -1
}

# True only for a live pid whose cwd is this checkout. Guards every kill, so a
# recycled or foreign pid in PID_FILE can never be signalled.
is_ours() {
  [ -n "$1" ] || return 1
  ps -p "$1" > /dev/null 2>&1 || return 1
  [ "$(pid_cwd "$1")" = "$CRM_DIR" ] || return 1
  return 0
}

# Our server is up when the port is held by a process from this checkout.
is_running() {
  is_ours "$(port_listener)"
}

# Describes the other occupant of the port, if it is not ours.
foreign_listener() {
  local listener
  listener=$(port_listener)
  [ -n "$listener" ] || return 1
  if is_ours "$listener"; then
    return 1
  fi
  echo "$listener"
}

start() {
  if is_running; then
    echo "✓ CRM is already running (PID: $(port_listener))"
    return 0
  fi

  local other
  if other=$(foreign_listener); then
    # Something already serves the port, so this script's goal is met and
    # nothing was started. Exit 0: at boot this competes with pm2, and a
    # non-zero exit there would be reported as a failed job, not a no-op.
    echo "- Port $PORT is already served by another process (PID: $other)"
    echo "  Its working directory: $(pid_cwd "$other")"
    echo "  That is not this checkout, so nothing was started here."
    echo "  To serve from this checkout instead, stop that process first."
    return 0
  fi

  echo "Starting Saving KC CRM..."
  PORT=$PORT nohup npm start > "$LOG_DIR/crm-$(date +%Y%m%d).log" 2>&1 &
  echo $! > "$PID_FILE"

  # npm start spawns the server as a child, so the listener appears a moment
  # later and is not the pid recorded above. Wait for the port, not the wrapper.
  local waited=0
  while [ "$waited" -lt 30 ]; do
    if is_running; then
      echo "✓ CRM started successfully (PID: $(port_listener))"
      echo "  URL: http://localhost:$PORT"
      return 0
    fi
    sleep 1
    waited=$((waited + 1))
  done

  echo "✗ Failed to start CRM (port $PORT not serving after ${waited}s)"
  echo "  See $LOG_DIR/crm-$(date +%Y%m%d).log"
  return 1
}

stop() {
  local other
  if other=$(foreign_listener); then
    echo "✗ Port $PORT is held by a process from $(pid_cwd "$other") (PID: $other)"
    echo "  Refusing to kill a process this script did not start."
    return 1
  fi

  local listener recorded killed=0
  listener=$(port_listener)
  recorded=$(get_pid)

  for pid in "$listener" "$recorded"; do
    [ -n "$pid" ] || continue
    is_ours "$pid" || continue
    echo "Stopping CRM (PID: $pid)..."
    kill "$pid" 2>/dev/null && killed=1
  done

  if [ "$killed" -eq 0 ]; then
    echo "CRM is not running"
    rm -f "$PID_FILE"
    return 0
  fi

  sleep 2

  # Escalate only against a pid still provably ours.
  for pid in "$listener" "$recorded"; do
    [ -n "$pid" ] || continue
    if is_ours "$pid"; then
      echo "Force killing PID $pid..."
      kill -9 "$pid" 2>/dev/null
    fi
  done

  rm -f "$PID_FILE"
  echo "✓ CRM stopped"
}

restart() {
  stop || return 1
  sleep 2
  start
}

status() {
  if is_running; then
    local pid
    pid=$(port_listener)
    echo "✓ CRM is running"
    echo "  PID: $pid"
    echo "  Port: $PORT"
    echo "  URL: http://localhost:$PORT"
    echo ""
    ps -p "$pid" -o pid,ppid,%cpu,%mem,etime,command
    return 0
  fi

  local other
  if other=$(foreign_listener); then
    echo "✗ CRM is not running from this checkout"
    echo "  Port $PORT is held by PID $other"
    echo "  Its working directory: $(pid_cwd "$other")"
    return 1
  fi

  echo "✗ CRM is not running"
  rm -f "$PID_FILE"
}

rebuild() {
  echo "Rebuilding CRM..."
  stop || return 1
  npm run build
  if [ $? -eq 0 ]; then
    echo "✓ Build successful"
    start
  else
    echo "✗ Build failed"
    return 1
  fi
}

case "$1" in
  start)
    start
    ;;
  stop)
    stop
    ;;
  restart)
    restart
    ;;
  status)
    status
    ;;
  rebuild)
    rebuild
    ;;
  logs)
    tail -f "$LOG_DIR"/crm-*.log
    ;;
  *)
    echo "Saving KC CRM Manager"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|rebuild|logs}"
    echo ""
    echo "Commands:"
    echo "  start    - Start the CRM"
    echo "  stop     - Stop the CRM"
    echo "  restart  - Restart the CRM"
    echo "  status   - Show CRM status"
    echo "  rebuild  - Rebuild and restart"
    echo "  logs     - Tail CRM logs"
    exit 1
    ;;
esac
