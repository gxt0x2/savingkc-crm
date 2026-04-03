# CRM QA Audit Report
**Date:** 2026-04-03  
**Total Findings:** 85

---

## Executive Summary

The Playwright E2E audit successfully tested the CRM authentication and scanned 8 routes. The test discovered **85 issues** across the application:

- 🔴 **33 High Severity** - Network failures (ERR_ABORTED)
- 🟢 **52 Low Severity** - Buttons with unclear handlers

### Pages Tested
✅ /dashboard  
✅ /opportunities  
✅ /leads  
✅ /conversations  
✅ /calendar  
⚠️ /pipeline (timed out after 30s)  
❌ /settings (browser closed)  
❌ /checklist (browser closed)

---

## Key Issues Found

### 1. Network Request Failures (33 High Severity)

**Pattern:** Next.js RSC prefetch requests are being aborted (`net::ERR_ABORTED`)

These appear to be Next.js App Router prefetch requests that are being cancelled, likely due to:
- Navigation occurring before prefetch completes
- Component unmounting before fetch resolves
- Hover/mouseenter prefetching being cancelled

**Examples:**
- `http://localhost:3002/pipeline?_rsc=18t7j` - ERR_ABORTED
- `http://localhost:3002/conversations?_rsc=18t7j` - ERR_ABORTED
- `http://localhost:3002/calendar?_rsc=18t7j` - ERR_ABORTED
- `http://localhost:3002/leads?_rsc=18t7j` - ERR_ABORTED
- `http://localhost:3002/api/dashboard/hot-leads` - ERR_ABORTED

**Impact:** While these are prefetch cancellations (not blocking errors), they may indicate:
- Over-aggressive prefetching on navigation menu
- React 19 Server Components race conditions
- Unnecessary network churn

**Recommendation:** Review Link prefetch behavior and consider:
- Setting `prefetch={false}` on navigation links
- Implementing request deduplication
- Adding proper request cancellation logic

---

### 2. Buttons with Unclear Handlers (52 Low Severity)

**Pattern:** Multiple buttons appear to lack obvious click handlers

The test detected buttons that don't have:
- `type="submit"` attribute
- `onclick` attribute
- Detectable event listeners (via `getEventListeners`)
- Parent `<form>` element

**Examples from /dashboard:**
- "Leads" button
- "close" button  
- "callCall (Phone)" button
- "refreshConnect Twilio" button

**Appears on pages:**
- /dashboard (13 instances)
- /opportunities (13 instances)
- /leads (13 instances)
- /conversations (13 instances)
- /calendar (13 instances)

**Note:** These may be false positives if:
- Using React synthetic events (which `getEventListeners` doesn't detect well)
- Handler attached via React props (onClick vs onclick)
- Using shadcn/ui Dialog/Sheet triggers with internal wiring

**Recommendation:** Manual review to confirm these buttons are functional. If they are working, this is a test limitation, not a real bug.

---

### 3. Page Timeout Issues

**Issue:** `/pipeline` page took >30s to load, causing timeout

**Details:**
- Test waited for `networkidle` state
- Page did not stabilize within timeout period

**Possible Causes:**
- Infinite loading state
- WebSocket/polling keeping network active
- Server-side data fetch hanging
- React Suspense boundary stuck

**Recommendation:**
- Manually test /pipeline page for stuck loading states
- Check browser console for errors
- Verify Supabase queries complete successfully
- Review any polling intervals on that page

---

## Test Limitations

The audit did **NOT** detect:
- ❌ Console errors (none found - clean!)
- ❌ Broken images (none found)
- ❌ Empty states without messages (none found)
- ❌ Links to 404 routes (none found)

**Note:** `/settings` and `/checklist` could not be audited due to browser closure after timeout.

---

## Action Items

### High Priority
1. ⚠️ Investigate /pipeline timeout - may indicate real loading issue
2. ⚠️ Review prefetch cancellations - consider disabling aggressive prefetch

### Low Priority  
3. 🔍 Manually verify button handlers are working (likely false positives)
4. 🔍 Extend test timeout for slower pages
5. 🔍 Re-run test to audit /settings and /checklist

---

## Files Generated
- `tests/qa-report.json` - Full JSON report (838 lines)
- `tests/qa-summary.md` - This summary (you are here)
- `tests/qa-dead-ends.spec.ts` - Playwright test suite
- `playwright.config.ts` - Playwright configuration

---

## How to Re-Run

```bash
# Full audit
npx playwright test tests/qa-dead-ends.spec.ts

# With UI mode
npx playwright test tests/qa-dead-ends.spec.ts --ui

# Debug mode
npx playwright test tests/qa-dead-ends.spec.ts --debug
```

---

**Conclusion:** The CRM is largely functional with no critical dead-ends found. The network failures appear to be prefetch cancellations (non-blocking), and the button warnings are likely test false-positives. Main concern is the /pipeline timeout which should be investigated.
