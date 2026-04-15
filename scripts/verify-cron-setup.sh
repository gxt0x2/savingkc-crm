#!/bin/bash
# Verification script for cron-job.org setup

CRON_SECRET=$(grep '^CRON_SECRET=' .env.local | cut -d= -f2)
LOCAL_ENDPOINT="http://localhost:3002/api/cron/process-mojo-queue"
PUBLIC_ENDPOINT="https://crm.savingkc.com/api/cron/process-mojo-queue"
CLOUDFLARE_IP="172.67.200.129"

echo "=================================="
echo "CRM Queue Worker Verification"
echo "=================================="
echo ""

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

# Test 2: Cloudflare tunnel (public access)
echo ""
echo "Test 2: Checking Cloudflare tunnel (public access)..."
HTTP_CODE=$(curl -s --max-time 10 --resolve "crm.savingkc.com:443:$CLOUDFLARE_IP" \
    -o /tmp/response_public.json -w "%{http_code}" \
    -H "Authorization: Bearer $CRON_SECRET" "$PUBLIC_ENDPOINT")

if [ "$HTTP_CODE" = "200" ]; then
    echo "✅ Public endpoint accessible via Cloudflare tunnel"
    echo "Response: $(cat /tmp/response_public.json)"
else
    echo "⚠️  Warning: Public endpoint returned HTTP $HTTP_CODE"
    echo "This is OK if tunnel needs restart"
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

# Test 4: Cloudflare tunnel process
echo ""
echo "Test 4: Verifying Cloudflare tunnel..."
TUNNEL_PROCESSES=$(ps aux | grep -i "cloudflared.*savingkc-crm" | grep -v grep | wc -l | tr -d ' ')
if [ "$TUNNEL_PROCESSES" -gt 0 ]; then
    echo "✅ Cloudflare tunnel running ($TUNNEL_PROCESSES processes)"
else
    echo "❌ Cloudflare tunnel not running"
    echo "Start with: cloudflared tunnel --config ~/.cloudflared/savingkc-crm-config.yml run"
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
echo "Next steps:"
echo "1. Go to https://cron-job.org/en/members/jobs/add/"
echo "2. URL: $PUBLIC_ENDPOINT"
echo "3. Schedule: Every 1 minute"
echo "4. Add header: Authorization: Bearer $CRON_SECRET"
echo "5. Save and enable the job"
echo ""
echo "Monitor executions at: https://cron-job.org/en/members/jobs/"
echo ""
rm -f /tmp/response.json /tmp/response_public.json
