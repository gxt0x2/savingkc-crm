#!/bin/bash

# Fix Silent Error Patterns
# This script adds proper error logging to all .catch(() => {}) patterns

echo "🔧 Fixing silent error patterns..."
echo ""

FIXED=0

# Function to fix a file
fix_file() {
  local file=$1
  local pattern=$2
  local replacement=$3
  local description=$4

  if grep -q "$pattern" "$file" 2>/dev/null; then
    echo "📝 Fixing $file - $description"
    sed -i '' "s|$pattern|$replacement|g" "$file"
    FIXED=$((FIXED + 1))
  fi
}

# Fix checkAutoAdvance silent errors
echo "🔴 CRITICAL: Fixing auto-advance errors..."
fix_file "src/app/api/call-log/route.ts" \
  "checkAutoAdvance(leadId, 'outbound_contact').catch(() => {})" \
  "checkAutoAdvance(leadId, 'outbound_contact').catch(err => console.error('[AUTO-ADVANCE] Failed:', err))" \
  "Auto-advance error logging"

fix_file "src/app/api/conversations/send/route.ts" \
  "checkAutoAdvance(leadId, 'outbound_contact').catch(() => {})" \
  "checkAutoAdvance(leadId, 'outbound_contact').catch(err => console.error('[AUTO-ADVANCE] Failed:', err))" \
  "Auto-advance error logging"

# Fix onCommunicationEvent silent errors
echo "🔴 CRITICAL: Fixing manifest sync errors..."
fix_file "src/app/api/call-log/route.ts" \
  "onCommunicationEvent(leadId, { type: 'outbound_call' }).catch(() => {})" \
  "onCommunicationEvent(leadId, { type: 'outbound_call' }).catch(err => console.error('[MANIFEST-SYNC] Failed:', err))" \
  "Manifest sync error logging"

# Fix logSmsSend silent errors
echo "🔴 CRITICAL: Fixing SMS dedup errors..."
fix_file "src/app/api/conversations/send/route.ts" \
  "logSmsSend(phone, body.trim(), effectiveFrom, leadId || undefined).catch(() => {})" \
  "logSmsSend(phone, body.trim(), effectiveFrom, leadId || undefined).catch(err => console.error('[SMS-DEDUP] Failed:', err))" \
  "SMS dedup error logging"

# Fix sendPushToAgents silent errors
echo "🟡 MEDIUM: Fixing push notification errors..."
for file in src/app/api/twilio-missed-call/route.ts src/app/api/twilio-sms-webhook/route.ts src/app/api/book/route.ts; do
  if [ -f "$file" ]; then
    if grep -q "sendPushToAgents.*}).catch(() => {})" "$file"; then
      echo "📝 Fixing $file - Push notification error logging"
      sed -i '' 's|}).catch(() => {})|}).catch(err => console.error("[PUSH] Failed:", err))|g' "$file"
      FIXED=$((FIXED + 1))
    fi
  fi
done

echo ""
echo "✅ Fixed $FIXED files"
echo ""
echo "🔍 Verification:"
echo "   Critical silent errors remaining:"
grep -r "checkAutoAdvance.*\.catch(() => {})" src/app/api --include="*.ts" 2>/dev/null | wc -l | xargs echo "     Auto-advance:"
grep -r "onCommunicationEvent.*\.catch(() => {})" src/app/api --include="*.ts" 2>/dev/null | wc -l | xargs echo "     Manifest sync:"
grep -r "logSmsSend.*\.catch(() => {})" src/app/api --include="*.ts" 2>/dev/null | wc -l | xargs echo "     SMS dedup:"

echo ""
echo "   Errors now being logged:"
grep -r "console\.error\('\[AUTO-ADVANCE\]" src/app/api --include="*.ts" 2>/dev/null | wc -l | xargs echo "     Auto-advance:"
grep -r "console\.error\('\[MANIFEST-SYNC\]" src/app/api --include="*.ts" 2>/dev/null | wc -l | xargs echo "     Manifest sync:"
grep -r "console\.error\('\[SMS-DEDUP\]" src/app/api --include="*.ts" 2>/dev/null | wc -l | xargs echo "     SMS dedup:"
grep -r "console\.error\('\[PUSH\]" src/app/api --include="*.ts" 2>/dev/null | wc -l | xargs echo "     Push notifications:"

echo ""
echo "Done! 🎉"
