#!/bin/bash
# PM2 Management Commands for Saving KC CRM

case "$1" in
  start)
    pm2 start ecosystem.config.js
    ;;
  stop)
    pm2 stop savingkc-crm
    ;;
  restart)
    pm2 restart savingkc-crm
    ;;
  status)
    pm2 list
    pm2 show savingkc-crm
    ;;
  logs)
    pm2 logs savingkc-crm
    ;;
  rebuild)
    echo "Rebuilding CRM..."
    npm run build && pm2 restart savingkc-crm
    ;;
  *)
    echo "Saving KC CRM - PM2 Management"
    echo ""
    echo "Usage: $0 {start|stop|restart|status|logs|rebuild}"
    echo ""
    echo "Commands:"
    echo "  start    - Start the CRM with PM2"
    echo "  stop     - Stop the CRM"
    echo "  restart  - Restart the CRM"
    echo "  status   - Show CRM status and details"
    echo "  logs     - Tail CRM logs"
    echo "  rebuild  - Rebuild and restart the CRM"
    exit 1
    ;;
esac
