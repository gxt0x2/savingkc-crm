# cron-job.org Setup Guide

## Account Setup
1. Go to: https://cron-job.org/en/signup/
2. Email: ernest@savingkc.com
3. Verify email and log in

## Create Cron Job

### Basic Settings
- **Title:** `SavingKC CRM - Process Mojo Queue`
- **URL:** `https://savingkc-crm-gxt0x2s-projects.vercel.app/api/cron/process-mojo-queue`
  - (Will update to custom domain once configured)
- **Schedule:** Every 1 minute
  - Select: "Every X minutes" → `1`

### Advanced Settings
Click "Advanced" tab:

**Request Method:** GET

**Custom Headers:**
- Header name: `Authorization`
- Header value: `Bearer 817bea9cc62e9f72b19676ae58d38bc197928e3de8955eac7b774d47bb08aedd`

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
  -H "Authorization: Bearer 817bea9cc62e9f72b19676ae58d38bc197928e3de8955eac7b774d47bb08aedd"
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
- Verify queue table has pending items
- Check cron-job.org execution history for failures

## Upgrade Options

### Free Tier Limits
- 1-minute minimum interval ✅ (we need this)
- 100 executions/day (1440 minutes/day, so we're over)

If we hit limits, upgrade to:
- **Basic Plan:** $3/month - unlimited executions
- **Plus Plan:** $7/month - includes monitoring, notifications, API access
