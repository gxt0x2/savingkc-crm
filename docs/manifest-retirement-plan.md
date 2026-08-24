# Manifest Retirement Plan

Manifest is retired as an operational source of truth, but its historical table is not deleted in an application release.

The AI-native operating system reads canonical evidence. AI does not make an old JSON document authoritative: lifecycle, owner, consent, suppression, communication state, tasks, campaign membership, and dispositions remain durable governed records. Manifest now remains only as historical storage while its archive is reconciled and rehearsed.

## Current boundary

- Canonical systems win every conflict.
- No new product feature may depend on Manifest for operational or compliance authority.
- The application has no active Manifest reader, writer, builder, enrichment, or sync runtime.
- Database-side auto-create, cascade, and update RPC writers are removed; service runtime roles cannot insert or update the historical table.
- The retired Manifest and bootstrap APIs return permanent 410 responses.
- County audience segmentation and direct ownership assignment do not read or write Manifest.
- Historical operations scripts still name the table. They are quarantined retirement debt, not application authority.

## Retirement sequence

1. **Contain.** Remove false source-of-truth language and block new operational consumers. Complete.
2. **Migrate authority.** Move stage, owner, consent, communication-state, next-action, and disposition reads to canonical entities and activities. Complete for application runtime.
3. **Project enrichment.** Move parcel, county, dwelling, assessment, tax, and seller-situation evidence into typed canonical property/intelligence records with provenance. Complete for application runtime.
4. **Move AI context.** Generate cited AI briefs from canonical evidence and durable generations; keep human approval for writes and outreach. Complete for the current briefing and proposal surfaces.
5. **Retire compatibility.** Legacy writers and runtime readers are disabled. Reconcile schema history, export and checksum historical JSON, then archive the table in a separately reviewed migration.

## Archive artifact contract

The physical cutover cannot run from an unverified database count or a repository-local data dump. Create the historical artifact in an existing approved encrypted location outside the Git checkout:

```bash
npm run manifest:archive:export -- --output-dir /approved/encrypted/location --project-ref <reviewed-production-project-ref>
npm run manifest:archive:verify -- --archive-dir /approved/encrypted/location/savingkc-manifest-archive-<timestamp>
```

The exporter is read-only. It requires the configured Supabase URL to match the explicitly reviewed production project reference, orders rows by primary key, serializes every row as canonical JSONL, writes files with owner-only permissions, records the exact row counts and SHA-256 checksum for both `manifests` and `manifest_history`, and deletes the partial directory if the source counts change during export. It refuses to place production data inside this repository. Verification reparses every line and recomputes the receipt before any archive migration may be approved.

The separately reviewed physical migration must match the verified receipt to the current source counts, preserve retained PPC foreign keys, revoke runtime access, and rehearse rollback. A receipt never authorizes deletion.

The writer shutdown preserves all 367 historical Manifest rows and 10,668 history rows observed in the production preflight. It does not delete, rewrite, or detach them from retained PPC history.

## Do not delete yet

Immediate deletion would bypass the required historical export, checksum, rollback rehearsal, and schema-history reconciliation. The application has reached zero operational authority and zero active writers; physical archive remains a separately reviewed data operation.
