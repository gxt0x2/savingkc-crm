# SavingKC CRM Mobile

Native mobile companion app for the SavingKC CRM.

## First Milestone

- Supabase sign-in using CRM credentials.
- Mobile API capability check through `/api/mobile/v1/session`.
- Fetch the latest CRM leads through `/api/mobile/v1/leads`.
- Open lead detail through `/api/mobile/v1/leads/:id`.
- Start an outbound call through the device dialer and save a disposition back through `/api/mobile/v1/calls/events`.
- Queue failed call events locally and retry them from the lead list.
- Establish the React Native/Expo Dev Client foundation needed for native Twilio Voice.

## Local Setup

```bash
cp .env.example .env
npm install
npm run start:dev-client
```

Expo Go is useful for basic UI checks, but the call stack will require an Expo Dev Client build once Twilio native Voice is added.
