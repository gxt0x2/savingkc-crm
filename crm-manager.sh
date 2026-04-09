#!/bin/bash
# Saving KC CRM Manager Script

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

is_running() {
  local pid=$(get_pid)
  if [ -n "$pid" ] && ps -p "$pid" > /dev/null 2>&1; then
    return 0
  fi
  return 1
}

start() {
  if is_running; then
    echo "✓ CRM is already running (PID: $(get_pid))"
    return 0
  fi

  echo "Starting Saving KC CRM..."
  PORT=$PORT nohup npm start > "$LOG_DIR/crm-$(date +%Y%m%d).log" 2>&1 &
  echo $! > "$PID_FILE"
  sleep 3

  if is_running; then
    echo "✓ CRM started successfully (PID: $(get_pid))"
    echo "  URL: http://localhost:$PORT"
  else
    echo "✗ Failed to start CRM"
    return 1
  fi
}

stop() {
  if ! is_running; then
    echo "CRM is not running"
    rm -f "$PID_FILE"
    return 0
  fi

  local pid=$(get_pid)
  echo "Stopping CRM (PID: $pid)..."
  kill "$pid" 2>/dev/null
  sleep 2

  if is_running; then
    echo "Force killing CRM..."
    kill -9 "$pid" 2>/dev/null
  fi

  rm -f "$PID_FILE"
  echo "✓ CRM stopped"
}

restart() {
  stop
  sleep 2
  start
}

status() {
  if is_running; then
    local pid=$(get_pid)
    echo "✓ CRM is running"
    echo "  PID: $pid"
    echo "  Port: $PORT"
    echo "  URL: http://localhost:$PORT"
    echo ""
    ps -p "$pid" -o pid,ppid,%cpu,%mem,etime,command
  else
    echo "✗ CRM is not running"
    rm -f "$PID_FILE"
  fi
}

rebuild() {
  echo "Rebuilding CRM..."
  stop
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
