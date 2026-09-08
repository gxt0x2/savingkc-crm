# SavingKC CRM Mobile

Native mobile companion app for the SavingKC CRM.

## Version 1 Scope

- Supabase sign-in using CRM credentials.
- Active contacts only; records marked not-a-lead/dead remain in the web archive.
- Outcome-aware conversation inbox backed by CRM communication activity.
- SMS and email sent through authenticated SavingKC server routes.
- Native Twilio Voice registration for inbound and outbound business calls.
- The signed-in user's assigned SavingKC caller ID is authoritative for calls and SMS.
- Open contact detail and save call outcomes back through `/api/mobile/v1/calls/events`.
- Review Mine or Unassigned event-backed work by department, complete versioned tasks, and accept explicit responsibility handoffs.
- View and change the canonical contact owner from contact detail; mobile never writes ownership or task state directly to Supabase.
- Queue failed call events locally and retry them from the lead list.
- Ask ARI read-only questions grounded in the signed-in user's authorized CRM scope.
- Open ARI from a contact to prepare a contact-360 briefing and next-action recommendation.

## Distribution

Use TestFlight internal testing for the three SavingKC users. This provides normal iPhone installation and update behavior without publishing the app publicly. A paid Apple Developer account, App Store Connect access, an Expo account, an EAS project ID, and Twilio iOS VoIP push credentials are required before the first device build.

TestFlight is the preferred path over ad-hoc sideloading: all three users receive the same signed build, updates are managed, and no device UUID registration is required. The `production` EAS profile is store-distributed; `development-device` remains available for native SDK debugging on registered devices.

### One-time account setup

1. Sign in to Expo (`npx eas-cli login`) and link or create the EAS project (`npx eas-cli init`).
2. Store `EAS_PROJECT_ID`, `EXPO_OWNER`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_CRM_API_BASE_URL=https://crm.savingkc.com` in the EAS `production` environment.
3. In Apple Developer/App Store Connect, register `com.savingkc.crm`, enable Push Notifications, create the app, and invite the other two users as internal TestFlight testers.
4. In Twilio, create the production iOS VoIP Push Credential for `com.savingkc.crm`; store its `CR...` SID as `TWILIO_VOIP_PUSH_CREDENTIAL_SID` in the CRM production environment. The mobile token route includes that credential in the VoiceGrant.
5. Deploy the CRM backend first so the bearer-authenticated ARI routes and VoIP-enabled token route are live at `https://crm.savingkc.com`.
6. Run `npm run distribution:check`, then `npm run release:ios`. After the build finishes, run `npm run submit:ios`.
7. On a physical iPhone, verify an outbound call and an inbound call while the device is locked and while the app is terminated before inviting the remaining internal testers.

The distribution check intentionally fails before the EAS account/project and production environment are linked. It never prints credential values.

## Local Setup

```bash
cp .env.example .env
npm install
npm run start:dev-client
```

Expo Go cannot load the native Twilio Voice SDK. Use an Expo development build during development and TestFlight for the three production users.

The ARI mobile surface reuses `/api/ai/command` and `/api/ai/threads` with the signed-in Supabase bearer token. The server validates that token and keeps the same actor-scoped, read-only tools and durable conversation ledger used by the web assistant.
