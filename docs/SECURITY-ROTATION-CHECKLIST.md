# Security Rotation Checklist

Last updated: 2026-04-26

## Immediate Actions (Do Today)

1. Revoke the exposed GitHub PAT that was previously embedded in local `git remote`.
2. Generate a replacement GitHub PAT with least privilege.
3. Rotate Twilio credentials:
   - `TWILIO_AUTH_TOKEN`
   - `TWILIO_API_KEY`
   - `TWILIO_API_SECRET`
4. Rotate Supabase credentials where feasible:
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` (if exposed outside approved surfaces)
5. Rotate any integration keys in use:
   - `GROQ_API_KEY`
   - `MERCURY_API_KEY`
   - `DOCUSEAL_TOKEN`
   - `SCRAPER_API_KEY`
   - `CRON_SECRET`

## Required Update Targets

After each rotation, update all active runtimes:

1. Vercel project `savingkc-crm` (`Production`, `Preview`, `Development` env scopes)
2. Local `.env.local` on trusted operator machines
3. Any cron/worker environments outside Vercel

## Verification Steps

1. `npm run gate:twilio` passes
2. `npm run gate:theme` and `npm run gate:routes` still pass
3. Live dialer token endpoint returns valid payload:
   - `GET /api/twilio-token` has `token`, `callerId`, `identity`
4. Outbound and inbound test calls complete successfully

## Hardening Controls Now in Place

1. GitHub Secret Scanning: enabled
2. GitHub Push Protection: enabled
3. CI `Secret Scan` workflow (Gitleaks) on PRs and pushes
4. Branch protection on `main` with required checks and review gate

## Operational Rules

1. Never embed credentials in remote URLs (`https://user:token@github.com/...`)
2. Never commit `.env*` files (only `.env.example` is allowed)
3. Never paste live credentials in PRs, issue comments, or deployment logs
4. Treat credential exposure as incident response: revoke first, investigate second
