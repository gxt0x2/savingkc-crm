#!/bin/bash
# Verification script for cron-job.org setup

ENV_FILE="${ENV_FILE:-.env.local}"
if [ ! -f "$ENV_FILE" ] && [ -f ".env.live" ]; then
    ENV_FILE=".env.live"
fi

CRON_SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" | cut -d= -f2- | sed -E 's/^["'\'']|["'\'']$//g')
LOCAL_ENDPOINT="http://localhost:3002/api/cron/process-mojo-queue"
PUBLIC_ENDPOINT="https://crm.savingkc.com/api/cron/process-mojo-queue"

echo "=================================="
echo "CRM Queue Worker Verification"
echo "=================================="
echo ""

if [ -z "$CRON_SECRET" ]; then
    echo "❌ CRON_SECRET missing in $ENV_FILE"
    exit 1
fi

# Test 1: Local endpoint accessibility
echo "Test 1: Checking local endpoint..."
HTTP_CODE=$(curl -s --max-time 5 -o /tmp/response.json -w "%{http_code}" \
    -H "Authorization: Bearer $CRON_SECRET" "$LOCAL_ENDPOINT")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Local endpoint accessible (HTTP 200)"
    echo "Response: $(cat /tmp/response.json)"
else
    echo "❌ Local endpoint failed (HTTP $HTTP_CODE)"
    cat /tmp/response.json 2>/dev/null || echo "No response body"
    exit 1
fi

# Test 2: Production endpoint
echo ""
echo "Test 2: Checking production endpoint..."
HTTP_CODE=$(curl -s --max-time 10 \
    -o /tmp/response_public.json -w "%{http_code}" \
    -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_ENDPOINT")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Production endpoint accessible"
    echo "Response: $(cat /tmp/response_public.json)"
else
    echo "⚠️  Warning: Public endpoint returned HTTP $HTTP_CODE"
fi

# Test 3: Authentication
echo ""
echo "Test 3: Checking authentication..."
UNAUTH_CODE=$(curl -s --max-time 5 -o /dev/null -w "%{http_code}" "$LOCAL_ENDPOINT")

if [ "$UNAUTH_CODE" = "401" ]; then
    echo "✅ Authentication required (401 without token)"
else
    echo "⚠️  Warning: Endpoint doesn't require authentication (got HTTP $UNAUTH_CODE)"
fi

# Test 4: Vercel cron configuration
echo ""
echo "Test 4: Verifying vercel.json cron..."
if grep -q '"/api/cron/process-mojo-queue"' vercel.json; then
    echo "✅ Vercel cron configured for process-mojo-queue"
else
    echo "❌ Vercel cron missing for process-mojo-queue"
    exit 1
fi

# Test 5: Next.js dev server
echo ""
echo "Test 5: Checking Next.js dev server..."
if lsof -i :3002 2>/dev/null | grep -q LISTEN; then
    echo "✅ Dev server running on port 3002"
else
    echo "❌ Dev server not running on port 3002"
    echo "Start with: npm run dev -- -p 3002"
    exit 1
fi

echo ""
echo "=================================="
echo "All checks passed! ✅"
echo "=================================="
echo ""
echo "Next step:"
echo "Deploy the current vercel.json so Vercel owns the queue processor cron."
echo ""
rm -f /tmp/response.json /tmp/response_public.json
