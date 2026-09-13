# Ari Prepare-with-Ari gateway retest

Updated: 2026-09-13. **This is not live send auth.** Customer send and prod Email migrate stay gated. `EMAIL_AI_ENABLED` stays off in hosted env.

Ops reported AI Gateway funded on `gxt0x2s-projects` (~$4.97 Free Credit, auto-reload off). The prior HTTP 403 for missing paid credits should be retestable **when this environment can authenticate to the gateway**.

## Result (this VM)

| Item | Value |
| --- | --- |
| Result | **FAIL** |
| Failure code | `AI_NOT_CONNECTED` |
| Model | `openai/gpt-5.6-luna` |
| Real generation returned | **No** |
| Input / output tokens | 0 / 0 |
| Cost / usage | **$0** (no billed attempt) |
| Live send | still gated |

## What this environment could check

- Public catalog `GET https://ai-gateway.vercel.sh/v1/models` → HTTP 200. `openai/gpt-5.6-luna` is present. Pricing still matches the product reservation (`input` 0.0000002, `output` 0.0000012).
- `EMAIL_AI_ENABLED` is unset. `AI_GATEWAY_API_KEY` is unset. `VERCEL_OIDC_TOKEN` is unset.
- `npx vercel whoami` → logged out. `vercel env pull` cannot mint OIDC from this VM.
- Vercel MCP can see team `gxt0x2s-projects` / project `savingkc-crm`. It cannot mint a gateway token.

The product path (`configuredEmailAiProvider` / `THR-REGENERATE` / Prepare with Ari) refuses to call the model without `EMAIL_AI_ENABLED=true` **and** a gateway key or OIDC token. That fail-closed behavior is why this VM did not spend credits.

## Exact blocker for Reed → Robin

This cloud-agent VM cannot complete the paid-credit retest. Robin (or a logged-in Vercel machine) needs to run one reserved generation after auth:

```sh
vercel env pull .env.local --yes   # mints VERCEL_OIDC_TOKEN; do not commit
# EMAIL_AI_ENABLED must stay false in hosted env. The script only uses OIDC/key.
npm run test:email:ari-retest
```

Until that returns `generated: true`, do **not** describe Ari as operational. Ops-reported credits are not the same as a successful Prepare-with-Ari generation.

Replay command: `npm run test:email:ari-retest` (`scripts/email/retest-ari-gateway.ts`). One attempt. No customer send.
