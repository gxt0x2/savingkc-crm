# Mojo Queue Cron Setup Guide

The preferred queue processor is the Vercel cron in `vercel.json`:

```json
{
  "path": "/api/cron/process-mojo-queue",
  "schedule": "*/15 * * * *"
}
```

Mojo email fallback sync is also scheduled in `vercel.json`:

```json
{
  "path": "/api/cron/sync-mojo-emails",
  "schedule": "*/15 13-22 * * 1-5"
}
```

That route uses connected Gmail OAuth tokens to parse actionable Mojo
notification emails and queue them into `mojo_call_queue`. It does not replace
the full Mojo web-session sync because notification emails may not include call
recordings or complete activity history.

Use cron-job.org only as a fallback if Vercel cron is unavailable.

## Account Setup
1. Go to: https://cron-job.org/en/signup/
2. Email: ernest@savingkc.com
3. Verify email and log in

## Create Cron Job

### Basic Settings
- **Title:** `SavingKC CRM - Process Mojo Queue`
- **URL:** `https://savingkc-crm-gxt0x2s-projects.vercel.app/api/cron/process-mojo-queue`
  - (Will update to custom domain once configured)
- **Schedule:** Every 5 minutes, 9am-5pm CT, Mon-Fri
  - Minutes: `*/5`
  - Hours: `9-16` (9:00 through 4:59pm CT)
  - Days of week: `1-5` (Mon-Fri)
  - Timezone: `America/Chicago`
  - Expected: ~96 runs/day (fits under free tier 100/day cap)

### Advanced Settings
Click "Advanced" tab:

**Request Method:** GET

**Custom Headers:**
- Header name: `Authorization`
- Header value: `Bearer $CRON_SECRET`

**Expected Response:**
- Status code: `200`
- Response contains: `processed`

### Notifications
- **Email on failure:** ✅ Enabled
- **Email on success:** ❌ Disabled
- **Notification email:** ernest@savingkc.com

### Save
- Click **"Create cronjob"**
- Ensure status shows **"Enabled"**

## Verification

### Test Manually
```bash
curl -X GET "https://savingkc-crm-gxt0x2s-projects.vercel.app/api/cron/process-mojo-queue" \
  -H "Authorization: Bearer $CRON_SECRET"
```

Expected response:
```json
{"processed":0,"elapsed_ms":500}
```

### Monitor Queue
Check Supabase mojo_call_queue table:
- Items should process within 1-2 minutes of being added
- `status` should change: pending → processing → completed

### Check Execution History
In cron-job.org dashboard:
- Click on the job
- View "Execution history"
- Should show green checkmarks for successful executions
- If red X, check the error message

## Troubleshooting

### 401 Unauthorized
- Check Authorization header is correct
- Verify CRON_SECRET in Vercel env vars matches

### 500 Server Error
- Check Vercel function logs
- Verify GROQ_API_KEY, SUPABASE_SERVICE_ROLE_KEY are set

### No items processing
- Check that Mojo sync endpoint is adding items to queue
- Check `/api/cron/sync-mojo-emails` if the Mojo session-cookie sync is down
- Verify queue table has pending items
- Check cron-job.org execution history for failures

## Upgrade Options

### Free Tier Limits
- 1-minute minimum interval
- 100 executions/day
- Current schedule (every 5 min, 9-5 M-F) = 96/day, fits under cap

If we need more frequent runs or 24/7 coverage, upgrade to:
- **Basic Plan:** $3/month - unlimited executions
- **Plus Plan:** $7/month - includes monitoring, notifications, API access
