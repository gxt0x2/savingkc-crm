# Gmail OAuth Repair

Date: 2026-05-04

## Finding

Production has Google Maps keys configured, but does not have `GOOGLE_OAUTH_CLIENT_ID` or `GOOGLE_OAUTH_CLIENT_SECRET` in Vercel. The Gmail settings card can list the saved `ernest@savingkc.com` connection from Supabase, but Gmail sync cannot refresh the saved Google token without those OAuth credentials.

## Impact

- Manual sync returns `token_refresh_failed` or `google_oauth_not_configured`.
- Background Gmail sync cannot import new email threads into lead records.
- Reconnecting Gmail will not work until the OAuth env vars are configured.

## Required Google Cloud Setup

Project observed locally: `savingkc-chat-bot`.

Create or locate a Google Auth Platform web OAuth client with this authorized redirect URI:

```text
https://crm.savingkc.com/api/auth/google/callback
```

Required scopes used by the CRM:

```text
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/gmail.send
https://www.googleapis.com/auth/gmail.modify
https://www.googleapis.com/auth/calendar
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/userinfo.profile
```

## Vercel Env Vars

Add these to Vercel Production, Preview, and Development:

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
```

Then redeploy production from `main`.

## Verification

1. Open `https://crm.savingkc.com/settings`.
2. The Gmail card should no longer show the missing OAuth config warning.
3. Click `Connect Gmail`.
4. Complete Google consent for `ernest@savingkc.com`.
5. Click `Sync now`.
6. Expected success format: `Scanned N emails · matched N · inserted N`.

## Rollback

Remove the two Vercel env vars and redeploy, or revert the UI/backend diagnostics patch. Removing the env vars disables Gmail sync but does not delete saved Supabase token rows.
