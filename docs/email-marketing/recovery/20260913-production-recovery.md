
Recovery implementation completed locally (release verification still pending):
- Hosted setup/import endpoints, independent verified sender domains, controlled recipient allowlist, real Resend dispatch and immutable per-intent envelopes.
- Stable provider idempotency; no automatic retry after uncertain requests. Provider acceptance survives secondary follow-up failure.
- Signed delivery events, correlated reply retrieval, suppression, conservative send caps and weekday follow-up cadence.
- Evidence-backed CSV import; unresolved identity/verification remains excluded. Suppression cannot be cleared through reimport.
- Scoped hosted database role, exact hosted-dispatch migration and production environment configured; sending remains disabled until a delivered test and inbound reply are proven.
- Local production webpack build, 108 unit tests, original 75 database tests plus 9 dispatch and 2 import tests passed. Hygiene, theme, routes, ESLint and high-severity dependency gate passed. Normal Turbopack proxy gate is reserved for CI because the local dependency symlink requires webpack.
- Runtime CRM grants are listed in runtime-grants.sql; no service-role membership granted.

Still required: user business mailing address; hosted controlled send and actual reply; live unsubscribe/task checks; AI generation availability; exact release commit/CI/production alias evidence. This is a bounded production pilot, not completion of all optional roadmap packets.

Live release evidence (22:12 UTC): PR #662 merged as 683e20bb; deployment savingkc-6r92by5hv-gxt0x2s-projects.vercel.app built that main commit and completed at 22:11:45 UTC. Signed-in crm.savingkc.com/marketing/email now loads the hosted Inbox and setup checklist. The authenticated worker returned 200 with idle inbound and outbound queues. Unauthenticated Email API requests returned 401. No runtime error rows were returned by the production 15-minute error-log query.

Team responsibilities saved through the live UI: Ernest reviewer, Casey acquisition owner, Gertha backup; weekdays 09:00–17:00 Central. Live sending remains off. The 7 local browser scenarios passed, with the setup scenario rerun after an initial development-page reload; clean automated scenarios exercise Lead/callback linking, notes, Upcoming, Scheduler and unsubscribe. The user Chrome profile adds a Scribe HTML attribute that produces a development hydration warning; the clean browser scenario reported no application page errors.

AI dependency: the configured openai/gpt-5.6-luna request returned 403 because only free AI Gateway credits are available. A free gpt-5-nano trial connected but failed full-output cases and hit rate limits; the configured production model was not changed. A minimum $10 credit purchase ($10.59 including processing fee, auto-reload disabled) is prepared but NOT paid, awaiting explicit owner approval. Business mailing address remains requested; no business address was inferred from payment details.
