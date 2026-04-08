# Deploy CRM to Vercel (5 Minutes)

## Step 1: Click This Link
https://vercel.com/new/clone?repository-url=https://github.com/gxt0x2/savingkc-crm

This will:
- Sign you into Vercel (or create free account)
- Import your GitHub repo automatically
- Start deployment wizard

## Step 2: Add Environment Variables

**Copy values from your `.env.local` file** and add them in Vercel:

Required variables:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY` - Your Supabase service role key
- `TWILIO_ACCOUNT_SID` - From Twilio console
- `TWILIO_AUTH_TOKEN` - From Twilio console  
- `TWILIO_PHONE_NUMBER` - Your Twilio number
- `ERNEST_PHONE` - Ernest's mobile number
- `CASEY_PHONE` - Casey's mobile number
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` - For push notifications
- `VAPID_PRIVATE_KEY` - For push notifications
- `TEST_MODE` - Set to `false` for production

**Tip:** Open `.env.local` on your computer and copy/paste each value into Vercel's environment variable form.

## Step 3: Click "Deploy"

Wait 2-3 minutes. You'll get a URL like: `savingkc-crm.vercel.app`

## Step 4: Add Custom Domain (Optional)

1. In Vercel dashboard → Settings → Domains
2. Add: `crm.savingkc.com`
3. Vercel shows you DNS records to add at your domain registrar
4. Add those DNS records
5. Wait 5-10 minutes for DNS to propagate

## Step 5: Configure Twilio Webhooks

Go to: https://console.twilio.com/us1/develop/phone-numbers/manage/incoming

Click your number: `+1 (816) 307-7835`

### Voice Configuration:
- **A CALL COMES IN:** Webhook → `https://crm.savingkc.com/api/ivr` → POST
- **PRIMARY HANDLER STATUS CALLBACK:** `https://crm.savingkc.com/api/twilio-missed-call` → POST

### Messaging Configuration:
- **A MESSAGE COMES IN:** Webhook → `https://crm.savingkc.com/api/twilio-sms-webhook` → POST

Click **Save**

## Step 6: Test

1. Call: `+1 (816) 307-7835`
2. Don't answer
3. Wait 60 seconds
4. Check your phone for SMS notification! 🎉

---

## That's It!

From now on:
- Push code to GitHub → Auto-deploys to Vercel
- CRM accessible 24/7 at `crm.savingkc.com`
- Notifications work automatically
- No maintenance needed

---

## Troubleshooting

**Deployment failed?**
- Check environment variables are all added
- Make sure TWILIO_AUTH_TOKEN is correct

**Notifications not working?**
- Verify Twilio webhooks are saved (Step 5)
- Check webhooks point to correct URL (https, not http)
- Test by calling the number and checking CRM logs

**Custom domain not working?**
- DNS can take 5-60 minutes to propagate
- Verify DNS records match what Vercel shows
- Try accessing via the .vercel.app URL first
