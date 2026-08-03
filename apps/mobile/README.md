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
- Queue failed call events locally and retry them from the lead list.

## Distribution

Use TestFlight internal testing for the three SavingKC users. This provides normal iPhone installation and update behavior without publishing the app publicly. A paid Apple Developer account, App Store Connect access, an Expo account, an EAS project ID, and Twilio iOS VoIP push credentials are required before the first device build.

## Local Setup

```bash
cp .env.example .env
npm install
npm run start:dev-client
```

Expo Go cannot load the native Twilio Voice SDK. Use an Expo development build during development and TestFlight for the three production users.
