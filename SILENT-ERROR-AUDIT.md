# Silent Error Audit Report

## ⚠️ FOUND: 15+ Silent Error Patterns in API Routes

**Pattern:** `.catch(() => {})` - Catches errors but doesn't log them

---

## 🔴 CRITICAL - Should Be Logged

### 1. Auto-Advance Pipeline Errors
**File:** `src/app/api/call-log/route.ts`

```typescript
// Line 63
checkAutoAdvance(leadId, 'outbound_contact').catch(() => {})

// Line 64
onCommunicationEvent(leadId, { type: 'outbound_call' }).catch(() => {})
```

**Risk:** Pipeline auto-advance failures go unnoticed
**Impact:** Leads stuck in wrong stage, no visibility

**Fix:**
```typescript
checkAutoAdvance(leadId, 'outbound_contact')
  .catch(err => console.error('[AUTO-ADVANCE] Failed:', err))

onCommunicationEvent(leadId, { type: 'outbound_call' })
  .catch(err => console.error('[MANIFEST-SYNC] Failed:', err))
```

---

### 2. Manifest Sync Errors (Multiple Locations)
**File:** `src/app/api/conversations/send/route.ts`

```typescript
// Line 99
checkAutoAdvance(leadId, 'outbound_contact').catch(() => {})

// Line 100
onCommunicationEvent(leadId, { type: 'outbound_sms', content: body.trim() }).catch(() => {})
```

**Risk:** Manifest updates fail silently
**Impact:** Manifest and leads table out of sync

**Fix:**
```typescript
checkAutoAdvance(leadId, 'outbound_contact')
  .catch(err => console.error('[AUTO-ADVANCE] Failed for lead', leadId, err))

onCommunicationEvent(leadId, { type: 'outbound_sms', content: body.trim() })
  .catch(err => console.error('[MANIFEST-SYNC] Failed for lead', leadId, err))
```

---

### 3. SMS Deduplication Logging
**File:** `src/app/api/conversations/send/route.ts`

```typescript
// Line 95
logSmsSend(phone, body.trim(), effectiveFrom, leadId || undefined).catch(() => {})
```

**Risk:** SMS dedup tracking fails, could send duplicate SMS
**Impact:** Violates TCPA, annoys prospects

**Fix:**
```typescript
logSmsSend(phone, body.trim(), effectiveFrom, leadId || undefined)
  .catch(err => console.error('[SMS-DEDUP] Failed to log:', err))
```

---

## 🟡 MEDIUM - Non-Critical But Should Log

### 4. Push Notifications (Multiple Locations)
**Files:**
- `src/app/api/twilio-missed-call/route.ts` (2 instances)
- `src/app/api/twilio-sms-webhook/route.ts` (3 instances)

```typescript
sendPushToAgents({ ... }).catch(() => {})
```

**Risk:** Push notification failures invisible
**Impact:** Agents miss alerts, but SMS still sent

**Fix:**
```typescript
sendPushToAgents({ ... })
  .catch(err => console.error('[PUSH] Failed:', err))
```

---

## 🟢 LOW - Acceptable Silent Failures

### 5. Dashboard Data Fetching
**File:** `src/app/(app)/dashboard/page.tsx` (7 instances)

```typescript
fetch('/api/dashboard/kpis').then(r => r.json()).then(setData).catch(() => {})
```

**Risk:** Dashboard widgets fail to load
**Impact:** UI only, user can refresh

**Status:** ✅ Acceptable - Frontend non-critical data

---

## 📊 Summary by Severity

| Severity | Count | Category | Action Required |
|----------|-------|----------|-----------------|
| 🔴 CRITICAL | 6 | Pipeline/Manifest sync | **FIX IMMEDIATELY** |
| 🟡 MEDIUM | 5 | Push notifications | **FIX SOON** |
| 🟢 LOW | 7 | Dashboard UI | **ACCEPTABLE** |
| **TOTAL** | **18** | | |

---

## 🔧 Recommended Fixes

### Quick Fix Script
Apply these changes to prevent silent failures:

```bash
# 1. Fix auto-advance errors
sed -i '' 's/checkAutoAdvance(\(.*\))\.catch(() => {})/checkAutoAdvance(\1).catch(err => console.error("[AUTO-ADVANCE] Failed:", err))/g' src/app/api/**/*.ts

# 2. Fix manifest sync errors
sed -i '' 's/onCommunicationEvent(\(.*\))\.catch(() => {})/onCommunicationEvent(\1).catch(err => console.error("[MANIFEST-SYNC] Failed:", err))/g' src/app/api/**/*.ts

# 3. Fix push notification errors
sed -i '' 's/sendPushToAgents(\(.*\))\.catch(() => {})/sendPushToAgents(\1).catch(err => console.error("[PUSH] Failed:", err))/g' src/app/api/**/*.ts
```

---

## 📋 Detailed Location List

### CRITICAL Errors to Fix:

1. **src/app/api/call-log/route.ts**
   - Line 63: `checkAutoAdvance()` - Pipeline auto-advance
   - Line 64: `onCommunicationEvent()` - Manifest sync

2. **src/app/api/conversations/send/route.ts**
   - Line 95: `logSmsSend()` - SMS dedup tracking
   - Line 99: `checkAutoAdvance()` - Pipeline auto-advance
   - Line 100: `onCommunicationEvent()` - Manifest sync
   - Line 138: `checkAutoAdvance()` - Email auto-advance
   - Line 139: `onCommunicationEvent()` - Email manifest sync

### MEDIUM Errors to Fix:

3. **src/app/api/twilio-missed-call/route.ts**
   - Line 156: `sendPushToAgents()` - Missed call push
   - Line 243: `sendPushToAgents()` - Unknown caller push

4. **src/app/api/twilio-sms-webhook/route.ts**
   - Line 155: `sendPushToAgents()` - Team SMS push
   - Line 234: `sendPushToAgents()` - YES reply push
   - Line 478: `sendPushToAgents()` - Hot lead SMS push
   - Line 566: `sendPushToAgents()` - Unknown SMS push

5. **src/app/api/book/route.ts**
   - Line 309: `sendPushToAgents()` - New booking push

---

## 🎯 Risk Assessment

### What Could Go Wrong?

**Scenario 1: Auto-Advance Failure**
```
1. Lead books appointment
2. checkAutoAdvance() tries to move lead to "qualified" stage
3. Update fails (DB error, network issue)
4. Error silently swallowed
5. Lead stuck in "intake" stage forever
6. Manual intervention required to fix
```

**Scenario 2: Manifest Sync Failure**
```
1. Agent sends SMS to lead
2. onCommunicationEvent() tries to log to manifest
3. Manifest update fails (race condition, DB error)
4. Error silently swallowed
5. Manifest missing SMS history
6. Hot Engine scoring incorrect
7. Ari briefing incomplete
```

**Scenario 3: SMS Dedup Failure**
```
1. Auto-reply SMS sent to prospect
2. logSmsSend() tries to record in dedup table
3. Insert fails (DB error)
4. Error silently swallowed
5. 24 hours later, same SMS sent again
6. TCPA violation risk
```

---

## ✅ Verification After Fixes

Run this to confirm all critical errors are logged:

```bash
# Should return 0 (no silent catches in critical paths)
grep -r "checkAutoAdvance.*\.catch(() => {})" src/app/api --include="*.ts" | wc -l
grep -r "onCommunicationEvent.*\.catch(() => {})" src/app/api --include="*.ts" | wc -l
grep -r "logSmsSend.*\.catch(() => {})" src/app/api --include="*.ts" | wc -l

# Should return > 0 (logging errors)
grep -r "checkAutoAdvance.*console\.error" src/app/api --include="*.ts" | wc -l
grep -r "onCommunicationEvent.*console\.error" src/app/api --include="*.ts" | wc -l
```

---

## 🚨 ANSWER TO YOUR QUESTION

**YES - There are currently 6 CRITICAL silent error patterns that could cause:**

1. ✅ **Pipeline auto-advance failures** (leads stuck in wrong stage)
2. ✅ **Manifest sync failures** (data inconsistency)
3. ✅ **SMS dedup failures** (duplicate texts, TCPA risk)

**These should be fixed ASAP.**

The good news: They're all non-blocking (won't crash the app), but they will cause data integrity issues that are hard to debug.
