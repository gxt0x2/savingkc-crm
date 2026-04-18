# 05 — Write-Path Audit

Every write to the `manifests` table must go through `updateManifestAndCascade`. Any other path is a bug. This file defines how to find them all and how to close them.

---

## Why this matters

The current self-nesting problem (`manifest.manifest.owner`) could only have been caused by one of two things:
1. `updateManifestAndCascade` is deep-merging instead of shallow-replacing.
2. Something other than `updateManifestAndCascade` is writing to the table.

Either way, the write discipline is broken. Fix the function *and* close every bypass, so the class of bug cannot recur.

---

## Step 1 — Grep for every call that touches the table

Run these from the repo root. Capture the output; each hit is a line to audit.

```bash
# Direct Supabase client writes to the table
rg -n "from\(['\"]manifests['\"]\)" --type=ts --type=tsx

# Raw SQL / RPC calls that mention the table
rg -n "manifests" --type=sql
rg -n "rpc\(" --type=ts --type=tsx | rg manifest

# Any function whose name contains "manifest" and looks like a writer
rg -n "(insert|update|upsert|delete).*manifest" --type=ts --type=tsx -i

# Row-level API endpoints
rg -n "app/api/.*manifest" --files
```

Record every match. Group by file.

---

## Step 2 — Classify each call

For every hit, classify into one of four buckets:

| Bucket | What to do |
|---|---|
| **A. The write path itself** (`updateManifestAndCascade` and its helpers) | Leave. Audit separately in Step 3. |
| **B. A read** (select, single, from the table for read-only) | Leave. Reads are fine. |
| **C. A legitimate write routed through the write path** | Leave. Verify the payload validates against Zod. |
| **D. A bypass — direct insert/update/upsert/delete not routed through the write path** | **Refactor to use `updateManifestAndCascade` or delete.** |

Produce a markdown table in a PR description:

| File | Line | Classification | Action | Notes |
|---|---|---|---|---|
| `src/app/api/leads/route.ts` | 47 | D | Refactor | Inline upsert, bypasses cascade |
| `src/lib/manifest/write.ts` | 12 | A | N/A | The function itself |
| `src/components/ManifestView.tsx` | 89 | B | N/A | Read for display |

---

## Step 3 — Audit `updateManifestAndCascade` itself

Open the function. Check these points in order:

1. **Does it call `manifestV2_1Schema.parse(payload)` before writing?** If not, add it at line 1 of the function body. No validation = no write.

2. **Does it use `Object.assign`, spread merging, or any lodash `merge` against the existing record?** If yes, that is the self-nesting source. Replace with shallow subtree replacement:
   ```typescript
   // WRONG — causes nesting
   const next = { ...existing.manifest, ...payload };

   // RIGHT — shallow replace per-subtree
   const next = { ...existing.manifest };
   for (const [key, value] of Object.entries(payload.subtrees)) {
     next[key] = value;   // whole subtree replaced, no merge
   }
   ```

3. **Does it write `hot_eligibility`, `completeness`, or `next_action.description` from the caller's payload?** If yes, strip those fields from the payload before write — they are derived. Log a warning when a caller attempts to set them.

4. **Does it write the `manifest_history` row?** If not, add the audit write. If the write fails, the whole transaction must roll back.

5. **Does it recompute `pipeline.days_in_current_station` and `pipeline.disposition_history_count`?** These are derived from history, not inputs.

6. **Is the whole thing wrapped in a transaction?** If not, wrap it. Either Supabase RPC with a PL/pgSQL function, or a client-side transaction using a single RPC round trip. Partial writes are data corruption.

---

## Step 4 — Add a runtime guard

Beyond grep, add a database-level guard. The naive approach (GUC + trigger) has two problems on Supabase:

1. `current_setting('app.write_path')` is session-scoped. On transaction-pooled connections (PgBouncer), the `set_config` call and the subsequent write can land on different sessions, making the GUC vanish and the trigger reject a legitimate write.
2. Supabase apps connect as `service_role`. If the trigger exempts `service_role` to let the app function, the guard is ceremonial — any `supabase.from('manifests').update(...)` bypass sails through. If it doesn't exempt `service_role`, normal app writes fail.

**The correct pattern: role-based lockdown with a `SECURITY DEFINER` function as the only permitted writer.**

### Step 4.1 — Create a dedicated writer role

```sql
-- Dedicated role that owns the write function. No login.
CREATE ROLE cascade_writer NOLOGIN;

-- Dedicated role for one-shot migrations. No login; granted temporarily.
CREATE ROLE manifest_migrator NOLOGIN;
```

### Step 4.2 — Revoke direct write permissions from app roles

```sql
REVOKE INSERT, UPDATE, DELETE ON manifests FROM service_role, authenticated, anon;
REVOKE INSERT, UPDATE, DELETE ON manifest_history FROM service_role, authenticated, anon;

-- Reads remain open for the app
GRANT SELECT ON manifests TO service_role, authenticated;
GRANT SELECT ON manifest_history TO service_role, authenticated;

-- Writes permitted only to the dedicated roles
GRANT INSERT, UPDATE, DELETE ON manifests        TO cascade_writer, manifest_migrator;
GRANT INSERT                   ON manifest_history TO cascade_writer, manifest_migrator;
```

Now the app literally cannot write to `manifests` directly. A stray `supabase.from('manifests').update(...)` fails with a PostgreSQL permission error before any trigger runs. That is the primary guard.

### Step 4.3 — Create the write function as `SECURITY DEFINER`, owned by `cascade_writer`

```sql
CREATE OR REPLACE FUNCTION update_manifest_and_cascade(
  p_manifest_id  uuid,
  p_subtrees     jsonb,
  p_actor        text,
  p_reason       text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER          -- runs with privileges of the function owner
SET search_path = public  -- prevent search_path hijack attacks
AS $$
DECLARE
  v_existing jsonb;
  v_next     jsonb;
  v_prior_hash text;
BEGIN
  -- 1. Load existing
  SELECT manifest INTO v_existing FROM manifests WHERE id = p_manifest_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Manifest not found: %', p_manifest_id;
  END IF;
  v_prior_hash := encode(digest(v_existing::text, 'sha256'), 'hex');

  -- 2. Shallow per-subtree replacement (NOT deep merge)
  v_next := v_existing;
  FOR subtree_key, subtree_value IN SELECT * FROM jsonb_each(p_subtrees) LOOP
    v_next := jsonb_set(v_next, ARRAY[subtree_key], subtree_value, true);
  END LOOP;

  -- 3. Recompute derived fields (hot_eligibility, completeness, next_action)
  -- ... delegated to helper functions ...

  -- 4. Write the main row
  UPDATE manifests SET manifest = v_next, updated_at = now() WHERE id = p_manifest_id;

  -- 5. Write the audit row in the same transaction
  INSERT INTO manifest_history (manifest_id, actor, reason, diff, prior_hash)
  VALUES (p_manifest_id, p_actor, p_reason,
          jsonb_build_object('before', v_existing, 'after', v_next),
          v_prior_hash);

  RETURN v_next;
END;
$$;

-- Reassign ownership to the dedicated writer role
ALTER FUNCTION update_manifest_and_cascade(uuid, jsonb, text, text)
  OWNER TO cascade_writer;

-- Grant execute to the app role
GRANT EXECUTE ON FUNCTION update_manifest_and_cascade(uuid, jsonb, text, text)
  TO service_role, authenticated;

-- Block direct execute from anon
REVOKE EXECUTE ON FUNCTION update_manifest_and_cascade(uuid, jsonb, text, text)
  FROM anon, public;
```

Because the function is `SECURITY DEFINER` and owned by `cascade_writer`, it writes with `cascade_writer`'s privileges regardless of who calls it. The app (as `service_role`) calls the function; the function writes the table; the table accepts the write because `cascade_writer` is authorized.

### Step 4.4 — Add a belt-and-suspenders trigger for defense in depth

With GRANTs as the primary guard, the trigger becomes a cheap secondary check. Its job is to catch the edge case where someone with manual DB access runs an ad-hoc UPDATE as `cascade_writer` directly (e.g., a panicked hotfix from psql).

```sql
CREATE OR REPLACE FUNCTION assert_cascade_actor()
RETURNS trigger AS $$
BEGIN
  -- Allow the dedicated roles. Anything else that somehow got GRANT
  -- (e.g., misconfiguration, future developer drift) fails here.
  IF current_user NOT IN ('cascade_writer', 'manifest_migrator') THEN
    RAISE EXCEPTION
      'Writes to manifests must go through update_manifest_and_cascade. Caller: %',
      current_user;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER manifests_write_guard
BEFORE INSERT OR UPDATE OR DELETE ON manifests
FOR EACH ROW EXECUTE FUNCTION assert_cascade_actor();
```

This works on pooled connections because it does not depend on any GUC. It reads `current_user`, which is set by authentication and is stable for the duration of any statement.

### Step 4.5 — App-side calling convention

The TypeScript write path becomes a thin wrapper:

```typescript
// src/lib/manifest/write.ts
export async function updateManifestAndCascade(params: {
  manifest_id: ManifestId;
  subtrees: Partial<ManifestV2_1>;
  actor: 'ernest' | 'casey' | 'ari' | 'system' | 'migration';
  reason: string;
}): Promise<ManifestV2_1> {
  // 1. Strip derived fields and log warnings
  const cleaned = stripDerivedFields(params.subtrees);

  // 2. Validate before the RPC call so errors surface in TypeScript
  //    (a subset schema for the subtrees being written)
  partialManifestV2_1Schema.parse(cleaned);

  // 3. Call the RPC — the ONLY sanctioned write path from the app
  const { data, error } = await supabase.rpc('update_manifest_and_cascade', {
    p_manifest_id: params.manifest_id,
    p_subtrees: cleaned,
    p_actor: params.actor,
    p_reason: params.reason,
  });

  if (error) throw new ManifestWriteError(error);
  return manifestV2_1Schema.parse(data);
}
```

### Step 4.6 — Studio and manual access discipline

Supabase Studio normally edits via `service_role`, which is now locked out of direct writes. This is intentional.

When Ernest needs to manually correct a manifest:
- **Preferred:** call the RPC from the Studio SQL editor. It works; `service_role` has EXECUTE permission.
- **Break-glass:** a time-boxed grant of `cascade_writer` membership to a specific admin user, revoked immediately after use, with the grant and revoke logged.

Document this in `docs/manifest-write-audit-2026-04.md` so future operators know the escape hatch exists and how to use it.

### Step 4.7 — Migration actor

For the one-shot migration in `04_MIGRATION_PLAN.md`, grant `manifest_migrator` to the migration script's DB user for the duration of the migration only:

```sql
GRANT manifest_migrator TO <migration_user>;
-- run migration
REVOKE manifest_migrator FROM <migration_user>;
```

The migration scripts still route through `update_manifest_and_cascade` per the doctrine; the migrator role exists so that if a migration step needs to bypass the RPC (e.g., bulk-inserting historical records during the transcript-extraction phase), it can — but only during the migration window, and the trigger still logs it under a distinct `current_user` for audit.

---

## Step 5 — Commit the findings as a permanent record

Create `docs/manifest-write-audit-2026-04.md` in the repo. Commit the table from Step 2 there. Every future audit amends this file. It becomes the institutional memory of why the system is structured the way it is.
