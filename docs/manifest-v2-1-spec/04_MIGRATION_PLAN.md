# 04 — Migration Plan

Moving every existing manifest from the current mess to V2.1 without data loss.

---

## Principles

1. **Idempotent.** Running the migration twice is a no-op the second time.
2. **Reversible.** A rollback snapshot is taken before any write.
3. **Dry-run first.** Every phase has a `--dry-run` mode that produces a diff report without writing.
4. **Batched.** 50 manifests at a time. Each batch is its own transaction. A failure in batch N does not roll back batch N-1.
5. **Audited.** Every migration write goes through `updateManifestAndCascade` with `last_actor: 'migration'`. The `manifest_history` table gets an entry for every changed record with `reason: 'v2.1 migration'`.

---

## Pre-migration checks

Run these queries first. Record the counts. They are your success baseline.

```sql
-- Total manifests
SELECT COUNT(*) FROM manifests;

-- Manifests with self-nesting (the bug we're killing)
SELECT COUNT(*) FROM manifests
WHERE data ? 'manifest';

-- Manifests with embedded transcripts
SELECT COUNT(*) FROM manifests
WHERE jsonb_path_exists(data, '$.** ? (@.type() == "string" && @.size() > 5000)');

-- Manifests with empty arrays or empty objects (to be eliminated)
SELECT COUNT(*) FROM manifests
WHERE data::text ~ '(\[\])|(\{\})';

-- Current schema versions present
SELECT data->>'schemaVersion' AS version, COUNT(*)
FROM manifests GROUP BY 1;
```

Expected after migration: first three queries return 0. Last query returns only `'2.1'`.

---

## Phase A — Snapshot

Before any migration runs:

```sql
CREATE TABLE manifests_backup_v2_0 AS SELECT * FROM manifests;
CREATE INDEX ON manifests_backup_v2_0 (id);
```

This is the rollback table. Do not drop it until the new schema has been in production for 30 days without incident.

---

## Phase B — Create sibling tables if missing

The new schema assumes these tables exist. Verify. Create if absent.

```sql
-- History / audit log (append-only)
CREATE TABLE IF NOT EXISTS manifest_history (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manifest_id    uuid NOT NULL REFERENCES manifests(id) ON DELETE CASCADE,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  actor          text NOT NULL,
  reason         text,
  diff           jsonb NOT NULL,     -- RFC 6902 JSON Patch (generated via fast-json-patch)
  prior_hash     text NOT NULL       -- sha256 of prior data, for chain verification
);
CREATE INDEX ON manifest_history (manifest_id, updated_at DESC);
```

The `diff` column stores an RFC 6902 JSON Patch produced by `fast-json-patch` (the `compare(before, after)` function). This gives a compact, standardized, replayable diff — far more useful than storing full before/after snapshots and cheaper to store. Reconstructing any prior state is a linear apply of patches in reverse. Add the dependency:

```bash
npm install fast-json-patch
```

In the `update_manifest_and_cascade` Postgres function (see file 05), the diff computation happens in TypeScript on the app side and is passed to the RPC as a pre-computed `jsonb` argument, rather than computed inside PL/pgSQL. This avoids needing a Postgres extension for JSON Patch generation.

-- Calls table is assumed to exist. Verify columns.
-- Required: id, lead_id, transcript_text, summary, recorded_at, duration_seconds, disposition
-- If transcript_text is missing, add it. Do NOT delete embedded transcripts from manifests
-- until this column is populated from them.
```

---

## Phase C — Extract transcripts out of manifests

For every manifest where the transcript lives embedded:

1. If `calls.transcript_text IS NULL` for the matching call, copy the transcript there.
2. Verify the copy (hash compare).
3. In the new manifest payload, leave only the `call_id` pointer in `sources.call_ids` and `sources.latest_call_id`. Delete the embedded transcript text.

**Script sketch:**

```typescript
// scripts/migration/02_extract_transcripts.ts
async function extractTranscripts(dryRun: boolean) {
  const { data: manifests } = await supabase
    .from('manifests')
    .select('id, data');

  for (const m of manifests) {
    const embeddedTranscripts = findEmbeddedTranscripts(m.data);
    for (const { callId, text } of embeddedTranscripts) {
      const { data: existingCall } = await supabase
        .from('calls').select('id, transcript_text')
        .eq('id', callId).single();

      if (!existingCall) {
        warn(`Orphan transcript in manifest ${m.id}, no matching call ${callId}`);
        continue;
      }

      if (existingCall.transcript_text && existingCall.transcript_text !== text) {
        warn(`Transcript mismatch for call ${callId}; keeping calls.transcript_text`);
      } else if (!existingCall.transcript_text) {
        if (!dryRun) {
          await supabase.from('calls')
            .update({ transcript_text: text })
            .eq('id', callId);
        }
      }
    }
  }
}
```

Run with `--dry-run` first. Review the warnings. Then apply.

---

## Phase D — Transform each manifest to V2.1

Per-manifest transform function. Pure, testable, idempotent.

```typescript
// scripts/migration/03_transform.ts
import { manifestV2_1Schema, type ManifestV2_1 } from '@/lib/manifest/schema';

export function transformToV2_1(old: unknown): ManifestV2_1 {
  const o = old as Record<string, any>;

  // Handle self-nesting: collapse manifest.manifest.* into manifest.*
  const collapsed = collapseSelfNesting(o);

  // Build each V2.1 subtree from wherever the data currently lives
  const next: ManifestV2_1 = {
    manifest_id: collapsed.manifestId || collapsed.id,
    lead_id: collapsed.leadId || collapsed.lead_id,

    seller: buildSeller(collapsed),
    property: buildProperty(collapsed),
    financials: buildFinancials(collapsed),
    situation: buildSituation(collapsed),         // may be undefined
    motivation: buildMotivation(collapsed),       // may be undefined
    personality: buildPersonality(collapsed),     // may be undefined

    pipeline: buildPipeline(collapsed),
    hot_eligibility: buildHotEligibility(collapsed),  // may be undefined
    completeness: computeCompleteness(collapsed),     // always set

    next_action: buildNextAction(collapsed),

    sources: buildSources(collapsed),
    meta: {
      schema_version: '2.1',
      created_at: collapsed.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
      last_actor: 'migration',
      briefing_stale: true,   // force re-brief on first Ari read
    },
  };

  // Validate before returning. Any failure = bug in this function, not bad data.
  return manifestV2_1Schema.parse(next);
}

function collapseSelfNesting(
  o: Record<string, any>,
  opts: { conflictResolution: 'prefer_outer' | 'prefer_inner' | 'per_field' }
): { collapsed: Record<string, any>; conflicts: FieldConflict[] } {
  // Recursively flatten manifest.manifest.* up into manifest.*
  // But NEVER blindly clobber — a deep-merge bug could have written
  // correct data at either level.
  const conflicts: FieldConflict[] = [];

  function walk(current: Record<string, any>, path: string[] = []): Record<string, any> {
    if (!current.manifest || typeof current.manifest !== 'object') {
      return current;
    }
    const inner = walk(current.manifest, [...path, 'manifest']);
    const outer = { ...current };
    delete outer.manifest;

    const merged: Record<string, any> = {};
    const allKeys = new Set([...Object.keys(inner), ...Object.keys(outer)]);

    for (const key of allKeys) {
      const innerVal = inner[key];
      const outerVal = outer[key];
      const hasInner = key in inner;
      const hasOuter = key in outer;

      if (hasInner && !hasOuter)      merged[key] = innerVal;
      else if (hasOuter && !hasInner) merged[key] = outerVal;
      else if (deepEqual(innerVal, outerVal)) {
        merged[key] = outerVal;  // no conflict, identical
      } else {
        // Genuine conflict. Record it. Resolve per strategy.
        conflicts.push({
          path: [...path, key],
          inner_value: innerVal,
          outer_value: outerVal,
          resolution: opts.conflictResolution,
        });
        merged[key] = resolveConflict(innerVal, outerVal, opts.conflictResolution);
      }
    }
    return merged;
  }

  return { collapsed: walk(o), conflicts };
}

function resolveConflict(inner: any, outer: any, strategy: string): any {
  switch (strategy) {
    case 'prefer_outer': return outer;
    case 'prefer_inner': return inner;
    case 'per_field':
      // Prefer non-null over null
      if (inner == null && outer != null) return outer;
      if (outer == null && inner != null) return inner;
      // Prefer the object with more populated leaf fields
      if (typeof inner === 'object' && typeof outer === 'object') {
        return countLeaves(outer) >= countLeaves(inner) ? outer : inner;
      }
      // Scalar conflict with both populated — can't safely decide. Flag.
      throw new AmbiguousConflictError({ inner, outer });
  }
}
```

### Conflict-report canary protocol

**Before running the full migration, run a conflict-report pass:**

1. Set `conflictResolution: 'per_field'` and run `transformToV2_1` in dry-run mode over every manifest with self-nesting.
2. Collect every `FieldConflict` emitted. Group by field path.
3. Collect every `AmbiguousConflictError` into a manual-review queue.
4. Write the conflict report to `scripts/migration/reports/self_nesting_conflicts_<timestamp>.md`. Structure:

```markdown
# Self-Nesting Conflict Report

Total manifests with self-nesting: <count>
Total conflicts detected: <count>
Ambiguous (requires manual review): <count>

## Field-level conflict frequency

| Path | Conflicts | Resolution used |
|---|---|---|
| motivation.score | 42 | per_field → outer (higher completeness) |
| seller.phones | 8 | per_field → outer (more entries) |
| notes | 3 | AMBIGUOUS — manual review |

## Ambiguous conflicts (first 10)

### Manifest <id> at path `notes`
- Inner: "Called 3/15, no answer"
- Outer: "Called 3/22, left voicemail"
- Both non-null scalars. Human must decide.
```

5. **Ernest reviews the top 10 ambiguous conflicts manually before proceeding.** No full-batch run until this review is done. Record the decisions; they inform the `resolveConflict` logic going forward.

6. Run a canary batch of 10 manifests with resolved conflicts. Review diffs field-by-field.

7. If canary is clean, run the full migration. Any remaining ambiguous conflicts halt the migration for that specific record and push it to the manual-review queue for human resolution.

**Principle:** silent data loss during migration is the worst possible outcome. Better to stop and ask than to blindly clobber.

Each `build*` helper has its own file and its own unit tests. Be defensive — the old data is messy.

**Rules for field-level transforms:**

- `redFlags: []` → `red_flags: null`
- `redFlags: {}` → `red_flags: null`
- field missing → leave missing (undefined)
- `"TBD"`, `"pending"`, `"unknown"` string values → `"pending"` sentinel where the schema allows, else null
- Any field whose value is itself the literal string `"null"` or `"undefined"` → null

---

## Phase E — Write back through `updateManifestAndCascade`

**Do not bypass the write path even for migration.** Route every migration write through `update_manifest_and_cascade`. If the migration must bypass (e.g., bulk transcript extraction writing to `calls` directly), that work uses the `manifest_migrator` role explicitly, is logged, and is documented as a one-shot exception.

### Step E.1 — Grant the migration role to the migration user

Before running the transform loop, at the Supabase SQL editor or via an admin script:

```sql
GRANT manifest_migrator TO <migration_db_user>;
```

The migration script's DB connection must use this user. Verify with `SELECT current_user;` inside a migration script dry run.

### Step E.2 — Run the transform loop

```typescript
for (const batch of chunk(manifests, 50)) {
  for (const m of batch) {
    const next = transformToV2_1(m.data);
    await updateManifestAndCascade({
      manifest_id: m.id,
      subtrees: {
        seller: next.seller,
        property: next.property,
        financials: next.financials,
        situation: next.situation,
        motivation: next.motivation,
        personality: next.personality,
        pipeline: next.pipeline,
        sources: next.sources,
        // hot_eligibility, completeness, next_action: recomputed by the function
      },
      actor: 'migration',
      reason: 'v2.1 migration',
    });
  }
  console.log(`Batch complete. Last manifest: ${batch[batch.length - 1].id}`);
}
```

Each call to `update_manifest_and_cascade` is its own transaction inside Postgres, so a failure in record N does not roll back records 1..N-1. The script logs per-batch progress so re-running after a crash resumes cleanly (idempotent per Principle 1 of this file).

### Step E.3 — Revoke the migration role immediately after

```sql
REVOKE manifest_migrator FROM <migration_db_user>;
```

Do not leave this grant in place. The role is time-boxed by policy. Audit it with:

```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_name = 'manifests';
```

Expected after revoke: only `cascade_writer` has INSERT/UPDATE/DELETE.

---

## Phase F — Verify

```sql
-- Every manifest now has schema_version 2.1
SELECT COUNT(*) FROM manifests WHERE data->'meta'->>'schema_version' != '2.1';
-- Expected: 0

-- No self-nesting remains
SELECT COUNT(*) FROM manifests WHERE data ? 'manifest';
-- Expected: 0

-- No embedded transcripts
SELECT COUNT(*) FROM manifests
WHERE length(data::text) > 50000;
-- Expected: 0 (a clean manifest is well under 50KB)

-- Every manifest passes Zod validation in a Node script
-- (run outside SQL, using manifestV2_1Schema.parse)
```

Validation script:

```typescript
// scripts/migration/04_verify.ts
import { manifestV2_1Schema } from '@/lib/manifest/schema';

async function verifyAll() {
  const { data } = await supabase.from('manifests').select('id, data');
  const failures: Array<{ id: string; issue: unknown }> = [];

  for (const row of data ?? []) {
    const result = manifestV2_1Schema.safeParse(row.data);
    if (!result.success) {
      failures.push({ id: row.id, issue: result.error.format() });
    }
  }

  console.log(`Verified ${data?.length} manifests. Failures: ${failures.length}`);
  if (failures.length > 0) {
    console.log(JSON.stringify(failures.slice(0, 10), null, 2));
    process.exit(1);
  }
}
```

CI runs this on every deploy after migration. Zero failures = green. Any failure blocks production.

---

## Rollback plan

If migration causes production issues:

```sql
BEGIN;
DELETE FROM manifests;
INSERT INTO manifests SELECT * FROM manifests_backup_v2_0;
COMMIT;
```

Downtime during rollback: seconds. The backup table is the insurance policy.

---

## Do not delete the backup table for 30 days

`manifests_backup_v2_0` stays until May 18, 2026 at the earliest. It is the only safety net.
