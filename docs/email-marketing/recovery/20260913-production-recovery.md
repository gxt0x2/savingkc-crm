
Recovery implementation completed locally (release verification still pending):
- Hosted setup/import endpoints, independent verified sender domains, controlled recipient allowlist, real Resend dispatch and immutable per-intent envelopes.
- Stable provider idempotency; no automatic retry after uncertain requests. Provider acceptance survives secondary follow-up failure.
- Signed delivery events, correlated reply retrieval, suppression, conservative send caps and weekday follow-up cadence.
- Evidence-backed CSV import; unresolved identity/verification remains excluded. Suppression cannot be cleared through reimport.
- Scoped hosted database role, exact hosted-dispatch migration and production environment configured; sending remains disabled until a delivered test and inbound reply are proven.
- Local production webpack build, 108 unit tests, original 75 database tests plus 9 dispatch and 2 import tests passed. Hygiene, theme, routes, ESLint and high-severity dependency gate passed. Normal Turbopack proxy gate is reserved for CI because the local dependency symlink requires webpack.
- Runtime CRM grants are listed in runtime-grants.sql; no service-role membership granted.

Still required: user business mailing address; hosted controlled send and actual reply; live unsubscribe/task checks; AI generation availability; exact release commit/CI/production alias evidence. This is a bounded production pilot, not completion of all optional roadmap packets.
