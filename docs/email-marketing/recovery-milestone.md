# First connected local workflow

This milestone replaces the earlier helper-by-helper completion claims. It does not replace the approved product design or declare any full implementation packet complete.

## Scope and ownership

Implement a transaction-backed, simulation-only vertical slice using the existing `em_*` campaign/identity tables and shared command IDs. New code lives in `src/lib/email/workflow/`, `src/components/email/`, the Email page/API, one additive migration and `tests/email-local/`. These paths intentionally cross EM-003/005/006/009/012/013/020/022/023/033/035 to prove their integration before resuming individual packets. The older isolated helpers are not authoritative implementations.

Production dispatch stays disabled. The local harness starts its own disposable PostgreSQL cluster and uses fabricated people with reserved `.test` addresses. The harness shares the application component, command service and SQL with the CRM. It supplies a fixed test identity at its own test-only HTTP boundary; it does not bypass CRM authentication or load CRM environment files. No real provider, AI, calendar, push or CRM lifecycle call is part of simulation.

## Required local journey

1. Create a draft, choose already-reviewed fixture recipients and edit two exact messages.
2. Review eligibility and the frozen content/recipient hash; reject stale review and concurrent enrollment.
3. Publish once, persist frozen version, thread, intents, receipt and audit atomically.
4. Simulate transport acceptance; persist message and schedule a weekday follow-up 7–10 calendar days after acceptance, target day 8.
5. Persist a synthetic inbound event once; stop queued sequence work and invalidate drafts before human review.
6. Take over with optimistic concurrency, save a reply and reject stale or suppressed sends.
7. Save a callback handoff with verbatim message evidence and a recipient-scoped in-app notification. This is an Email handoff awaiting CRM integration, not a booked appointment or a qualified Opportunity.
8. Apply marketing suppression across campaign domains and confirmed aliases; cancel queued work and show stopped state.
9. Reload the application and confirm persisted state. Verify negative authorization, races, retries and rollback directly against PostgreSQL; inspect desktop/mobile UI.

## Explicit remaining work

Canonical CRM Lead/task bridge, shared Conversations/mobile controls, real provider and webhook verification, durable remote-dispatch reconciliation, AI evaluations, push/calendar/phone integrations, import/verification services, full setup wizard, operational reporting and production release are still separate unfinished work. Do not count simulation as proof of any of these integrations.
