# [P1] Login broken app-wide: server-side Supabase clients use the disabled legacy `anon` key

**Severity:** P1 (authentication is broken — no one can establish a new session)
**Area:** Auth / Supabase SSR
**Discovered:** 2026-07-01

## Summary

Supabase **disabled the project's legacy API keys (`anon`, `service_role`) on 2026-05-01**.
The browser client was migrated to the new **publishable** key, but the **server-side**
Supabase clients (the session validator in `proxy.ts` and the SSR helpers) still pass the
now-disabled `NEXT_PUBLIC_SUPABASE_ANON_KEY`. As a result, every server-side
`supabase.auth.getUser()` call fails, so:

- A user signs in successfully in the browser (publishable key works), but
- `proxy.ts` cannot validate the resulting session cookie (dead anon key) →
- the request is treated as unauthenticated → user is redirected back to `/login`.

Net effect: **login appears to "not work" — it silently loops back to the sign-in page.**

## Symptoms

- Enter correct email + password on `/login`, click **Sign In** → returns to `/login`, no visible error.
- Google / Magic Link also fail (same server-side validation).
- `/api/*` protected routes return `{"error":"Unauthorized"}` even for a logged-in browser.

## Root cause (evidence)

Direct call to the auth endpoint with the **legacy anon key** returns 401:

```
POST https://fprrknfyzlthbxewnwmi.supabase.co/auth/v1/token?grant_type=password
apikey: <NEXT_PUBLIC_SUPABASE_ANON_KEY>
→ HTTP 401
{"message":"Legacy API keys are disabled",
 "hint":"Your legacy API keys (anon, service_role) were disabled on 2026-05-01... 
         Re-enable them in the Supabase dashboard, or use the new publishable and secret API keys."}
```

Same call with the **publishable key** works (auth backend is healthy):

```
POST .../auth/v1/token?grant_type=password
apikey: <NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY>   (sb_publishable_...)
→ HTTP 400 {"error_code":"invalid_credentials","msg":"Invalid login credentials"}   # expected for bogus creds
```

The disabled anon key is compiled into the server bundle and used at runtime by the
SSR clients below.

## Affected files (use the publishable key, keep anon as fallback)

Apply the same precedence the browser client already uses:
`process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY`.
(There is already a helper in `src/lib/supabase/env.ts` on the production branch that does this —
prefer reusing it so there is a single source of truth.)

| File | Line | Current |
|------|------|---------|
| `proxy.ts` | ~67 | `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!` |
| `src/lib/supabase/server.ts` | ~9 | `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!` |
| `src/lib/supabase/middleware.ts` | ~9 | `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!` |
| `src/app/api/twilio-token/route.ts` | ~79 | `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!` |
| `src/lib/supabase/client.ts` | ~6 | `process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!` (on branches where not yet migrated) |

> Note: branches differ. On `codex/ppc-tax-public-launch`, `client.ts` and `env.ts` already
> prefer the publishable key; the remaining offenders are `proxy.ts`, `server.ts`,
> `middleware.ts`, `twilio-token/route.ts`. On other branches (`codex/secret-hygiene-hardening`),
> `client.ts` also still needs the fallback. Grep before editing:
> `grep -rn "NEXT_PUBLIC_SUPABASE_ANON_KEY" src proxy.ts | grep -v PUBLISHABLE`

## Fix

For each affected file, replace the bare anon key with the publishable-preferred value.
Preferred implementation — a single shared accessor (add to `src/lib/supabase/env.ts` if not present):

```ts
export function getSupabaseBrowserKey(): string {
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!key) throw new Error('Missing Supabase publishable/anon key')
  return key
}
```

Then in `proxy.ts`, `server.ts`, `middleware.ts`, `twilio-token/route.ts`, `client.ts`:

```ts
createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseBrowserKey(), { ... })
```

Do **not** rely on re-enabling the legacy keys as the permanent fix — they were disabled by
Supabase and should stay disabled. (Re-enabling them in the dashboard is a valid *temporary*
unblock, but the code must not depend on legacy keys.)

Also audit any server code that uses `SUPABASE_SERVICE_ROLE_KEY` and prefer
`SUPABASE_SECRET_KEY` (the new secret key). `src/lib/supabase/admin.ts` already prefers
`SUPABASE_SECRET_KEY || SUPABASE_SERVICE_ROLE_KEY` — mirror that everywhere service-role is used.

## Verification

1. Build and run. From the app origin, sign in with a real email+password → should land on the
   target page and stay authenticated (no bounce to `/login`).
2. `curl` a protected API while carrying the session cookie → 200 (not 401).
3. Sanity: `POST /auth/v1/token?grant_type=password` with the **publishable** key returns 400
   `invalid_credentials` for bogus creds and 200 for real creds.
4. Confirm no runtime references to the disabled anon key remain in the server bundle:
   `grep -rn "NEXT_PUBLIC_SUPABASE_ANON_KEY" src proxy.ts | grep -v PUBLISHABLE` → only fallbacks.

## Deployment note

Production (`crm.savingkc.com` / pm2 `savingkc-crm`) is served from
`/Users/ernestdodson/savingkc-crm-ppc-sell` on branch `codex/ppc-tax-public-launch` — build and
restart there (`npm run build` + `pm2 restart savingkc-crm`), not in the main working copy.
If the same code runs in production, team logins have likely been failing since 2026-05-01;
treat this as a live incident.
