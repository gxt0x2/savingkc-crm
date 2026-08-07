# CRM system hygiene

This control prevents new code, infrastructure, polling, and data-retention debt from entering the CRM unnoticed. It does not automatically delete legacy code or production data.

## Required ownership

`src/config/system-registry.json` is the source of truth for:

- business owner and lifecycle status for each CRM system;
- user and API routes;
- database tables;
- environment-variable names, never their values;
- scheduled jobs and the reason for high-frequency schedules;
- approved browser polling and its minimum interval.

Any pull request that introduces one of these resources must register it in the same change.

## Local and CI gate

Run the gate against the branch you intend to merge into:

```bash
npm run hygiene -- --base origin/main
```

The pull-request workflow chooses the PR base automatically. The gate is baseline-aware: historical debt is reported separately, while new or worsened debt fails the change.

The gate currently blocks:

- an unowned cron, route, database table, or environment reference;
- new polling without an explicit approved interval and reason;
- new files over the size limit or significant growth in oversized legacy files;
- lint errors or warnings in changed JavaScript and TypeScript files;
- temporary/versioned source files such as `page-old.tsx`;
- unused newly added runtime dependencies;
- destructive SQL without a documented, bounded justification.

## Retention safety model

The daily `/api/cron/data-retention` request is monitor-only. It records a bounded preview of rows older than each policy cutoff.

Deletion requires every applicable gate:

1. the table policy has `monitoring_enabled = true`;
2. the table policy has `deletion_enabled = true`;
3. archive-required policies have an archive reference and verification timestamp;
4. the deployment has `DATA_RETENTION_MUTATIONS_ENABLED=true`;
5. an authenticated administrator explicitly calls `POST /api/cron/data-retention?mode=apply`.

The Vercel cron uses `GET`, so scheduled execution cannot enter apply mode. Each apply is batch-limited and audited in `data_retention_runs`.

## Safe cleanup cadence

Monthly:

- review System Health in Settings;
- inspect retention candidates and worker failures;
- classify deprecated features and unused dependencies;
- identify zero-row or unreferenced tables, but do not drop them from a usage count alone.

Quarterly:

- archive approved high-volume history before enabling its deletion policy;
- remove deprecated code only after route, data, automation, and production-access checks pass;
- prune obsolete Git worktrees and branches only after confirming they contain no unique or uncommitted work.

Use a separate pull request for each cleanup domain. Quarantine first, verify the hosted user story, then delete in a later change.
