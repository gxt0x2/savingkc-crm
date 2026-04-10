#!/bin/bash
# restart-tunnel.sh — Restarts Quick Tunnel, updates .env.local, restarts server, updates Twilio
# Usage: ./scripts/restart-tunnel.sh

set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env.local"
LOG_DIR="/tmp"
TUNNEL_LOG="$LOG_DIR/crm-tunnel.log"
SERVER_LOG="$LOG_DIR/crm-next.log"

TWILIO_SID="ACa20f2f747d263115871f6053f42912e7"
TWILIO_TOKEN="910012a4c445a70f24ffeefec66cf91d"

PORT=3002
MAX_WAIT=15

echo "=== CRM Tunnel Restart ==="
echo ""

# 1. Kill existing quick tunnels (but NOT named tunnels we need for other services)
echo "[1/6] Stopping old quick tunnel..."
pkill -f "cloudflared tunnel --url" 2>/dev/null || true
sleep 1

# 2. Start new Quick Tunnel (HOME=/tmp avoids credential conflicts with named tunnels)
echo "[2/6] Starting new Quick Tunnel..."
rm -f "$TUNNEL_LOG"
HOME=/tmp nohup cloudflared tunnel --url "http://localhost:$PORT" > "$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

# Wait for tunnel URL to appear
TUNNEL_URL=""
for i in $(seq 1 $MAX_WAIT); do
  TUNNEL_URL=$(grep -o "https://[a-z0-9-]*\.trycloudflare\.com" "$TUNNEL_LOG" 2>/dev/null | head -1 || true)
  if [ -n "$TUNNEL_URL" ]; then
    break
  fi
  sleep 1
done

if [ -z "$TUNNEL_URL" ]; then
  echo "FATAL: Tunnel failed to start after ${MAX_WAIT}s"
  cat "$TUNNEL_LOG"
  exit 1
fi
echo "  Tunnel: $TUNNEL_URL (PID $TUNNEL_PID)"

# 3. Update .env.local
echo "[3/6] Updating .env.local..."
if grep -q "^NEXT_PUBLIC_APP_URL=" "$ENV_FILE" 2>/dev/null; then
  sed -i '' "s|^NEXT_PUBLIC_APP_URL=.*|NEXT_PUBLIC_APP_URL=$TUNNEL_URL|" "$ENV_FILE"
else
  echo "" >> "$ENV_FILE"
  echo "# Tunnel URL for IVR callbacks (updated by restart-tunnel.sh)" >> "$ENV_FILE"
  echo "NEXT_PUBLIC_APP_URL=$TUNNEL_URL" >> "$ENV_FILE"
fi
echo "  NEXT_PUBLIC_APP_URL=$TUNNEL_URL"

# 4. Restart Next.js server
echo "[4/6] Restarting Next.js server..."
kill $(lsof -ti:$PORT) 2>/dev/null || true
sleep 2
cd "$PROJECT_DIR"
nohup npx next start -p $PORT > "$SERVER_LOG" 2>&1 &

# Wait for server to be ready
for i in $(seq 1 $MAX_WAIT); do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://localhost:$PORT" 2>/dev/null || echo "000")
  if [ "$HTTP_CODE" = "307" ] || [ "$HTTP_CODE" = "200" ]; then
    echo "  Server ready (HTTP $HTTP_CODE)"
    break
  fi
  if [ "$i" -eq "$MAX_WAIT" ]; then
    echo "WARNING: Server may not be ready (HTTP $HTTP_CODE)"
  fi
  sleep 1
done

# 5. Update ALL Twilio phone number webhooks
echo "[5/6] Updating Twilio webhooks (all numbers)..."
NUMBERS=$(curl -s -u "$TWILIO_SID:$TWILIO_TOKEN" \
  "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/IncomingPhoneNumbers.json?PageSize=50" \
  | python3 -c "
import sys, json
d = json.load(sys.stdin)
for n in d['incoming_phone_numbers']:
    print(n['sid'] + '|' + n['phone_number'])
" 2>/dev/null || true)

UPDATE_COUNT=0
FAIL_COUNT=0
while IFS='|' read -r sid phone; do
  [ -z "$sid" ] && continue
  RESULT=$(curl -s -X POST \
    "https://api.twilio.com/2010-04-01/Accounts/$TWILIO_SID/IncomingPhoneNumbers/$sid.json" \
    -u "$TWILIO_SID:$TWILIO_TOKEN" \
    -d "VoiceUrl=$TUNNEL_URL/api/twiml-voice" \
    -d "VoiceMethod=POST" \
    -d "SmsUrl=$TUNNEL_URL/api/twilio-sms-webhook" \
    -d "SmsMethod=POST" 2>/dev/null)
  CHECK=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin).get('voice_url',''))" 2>/dev/null || true)
  if echo "$CHECK" | grep -q "trycloudflare"; then
    UPDATE_COUNT=$((UPDATE_COUNT + 1))
  else
    echo "  FAILED: $phone"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done <<< "$NUMBERS"
echo "  Updated $UPDATE_COUNT numbers ($FAIL_COUNT failed)"

# 6. Run tests
echo "[6/6] Testing..."

# Wait for tunnel DNS to propagate
echo "  Waiting for tunnel to become reachable..."
for i in $(seq 1 15); do
  PROBE=$(curl -s -o /dev/null -w "%{http_code}" "$TUNNEL_URL/" --max-time 5 2>/dev/null || true)
  if [ "$PROBE" != "000" ]; then
    echo "  Tunnel reachable (HTTP $PROBE)"
    break
  fi
  if [ "$i" -eq 15 ]; then
    echo "  WARNING: Tunnel may not be reachable yet"
  fi
  sleep 1
done
echo ""

PASS=0
FAIL=0

# Test 1: Tunnel connectivity
TWIML=$(curl -s -X POST "$TUNNEL_URL/api/twiml-voice" \
  -d "From=%2B15555555555&To=%2B18166088588&CallSid=SCRIPT_TEST" \
  --max-time 10 || true)

if echo "$TWIML" | grep -q "<Response>"; then
  echo "  [PASS] IVR entry point returns valid TwiML"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] IVR entry point — no TwiML response"
  FAIL=$((FAIL + 1))
fi

# Test 2: Callback URLs use tunnel
if echo "$TWIML" | grep -q "$TUNNEL_URL"; then
  echo "  [PASS] Callback URLs use tunnel"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] Callback URLs not using tunnel"
  FAIL=$((FAIL + 1))
fi

# Test 3: Handle-input (press 1)
INPUT_TWIML=$(curl -s -X POST "$TUNNEL_URL/api/ivr/handle-input?from=%2B15555555555&calledNumber=%2B18166088588" \
  -d "Digits=1" --max-time 10 || true)

if echo "$INPUT_TWIML" | grep -q "<Dial"; then
  echo "  [PASS] Handle-input (press 1) dials agents"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] Handle-input broken"
  FAIL=$((FAIL + 1))
fi

# Test 4: Voicemail endpoint
VM_TWIML=$(curl -s -X POST "$TUNNEL_URL/api/ivr/voicemail?agent=Ernest&from=%2B15555555555" \
  --max-time 10 || true)

if echo "$VM_TWIML" | grep -q "<Record"; then
  echo "  [PASS] Voicemail endpoint works"
  PASS=$((PASS + 1))
else
  echo "  [FAIL] Voicemail endpoint broken"
  FAIL=$((FAIL + 1))
fi

# Test 5: No crm.savingkc.com leaking into callbacks
if echo "$INPUT_TWIML" | grep -q "crm.savingkc.com"; then
  echo "  [FAIL] crm.savingkc.com still leaking into callback URLs"
  FAIL=$((FAIL + 1))
else
  echo "  [PASS] No crm.savingkc.com in callback URLs"
  PASS=$((PASS + 1))
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Some tests failed. Check logs:"
  echo "  Tunnel: $TUNNEL_LOG"
  echo "  Server: $SERVER_LOG"
  exit 1
fi

echo "Phone system is LIVE at $TUNNEL_URL"
echo "Tunnel PID: $TUNNEL_PID"
echo ""
echo "If the tunnel dies, re-run: ./scripts/restart-tunnel.sh"
