# Manifest Write-Path Audit — April 18, 2026

Per `docs/manifest-v2-1-spec/05_WRITE_PATH_AUDIT.md` Phase 2. Classification of every touch of the `manifests` table in `src/`. **No code changes in this audit — this is findings only.** Bypasses are closed in Phase 5, the canonical write path is hardened in Phase 3.

## Scope

`src/**/*.{ts,tsx}`. Excludes `.claude/worktrees/**` (prior Claude Code scratch sessions, not production). Excludes `scripts/` and tests.

## Summary

73 distinct `manifests` touches classified across the five files that matter for Phase 5.

| Bucket | Count | Meaning |
|---|---|---|
| **A** — the write path itself | 6 lines in `manifest-sync.ts` | Hardened in Phase 3 |
| **B** — reads (`.select(...)`) | 56 | Leave alone |
| **C** — writes routed through `updateManifestAndCascade` | 10 | Verify Zod validation in Phase 3 |
| **D** — direct `.insert/.update/.delete` bypasses | **5** | **Phase 5 closes these** |
| **C-doctrine-violation** — through the path but with `deepMerge` | **1** | **Fix at same time as Phase 5** |

The canonical write path already exists: `updateManifestAndCascade` at `src/lib/manifest-sync.ts:475`, with internal helpers `saveManifest` (`:72`) and `ensureManifestExists` (around `:427`). 10 call sites already use it correctly. 5 bypass it. 1 routes through it but with a deep-merge callback that's almost certainly the source of the `manifest.manifest.*` self-nesting bug.

---

## The 5 bypasses — Phase 5 work

### 1. `src/lib/prospect-to-lead.ts:171` — direct `.insert()`

```ts
await supabase.from('manifests').insert({ lead_id, version: 2, manifest, ... })
```

Creates a manifest on prospect → lead conversion without going through `ensureManifestExists` / `updateManifestAndCascade`. Skips the cascade, skips Zod validation, skips history write.

**Fix:** replace with `ensureManifestExists(leadId, initialManifest)` or `updateManifestAndCascade(leadId, ...)` depending on whether the manifest exists already.

### 2. `src/app/api/manifests/route.ts:75` — direct `.insert()`

`POST /api/manifests` creates manifests without write-path discipline.

**Fix:** route through `updateManifestAndCascade` + `ensureManifestExists`.

### 3. `src/app/api/manifests/route.ts:136` — direct `.update()`

Same endpoint's enrichment update path — direct update, no cascade to `leads`, no derived-field recomputation.

**Fix:** refactor to `updateManifestAndCascade(leadId, ...)`.

### 4. `src/lib/hot-engine/cache.ts:492` — direct `.update()`

```ts
await supabase.from('manifests').update({ manifest, updated_at: ... }).eq('id', row.id)
```

Hot signal injection. No cascade, no history row, no derived-field recompute. This one is particularly dangerous because it's in the Hot Opportunities scoring path — the very system whose inputs the V2.1 `hot_eligibility` block is meant to standardize.

**Fix:** route through `updateManifestAndCascade`. Signal writes become a subtree replacement of `hot_eligibility` (or its V2.0 equivalent until the migration runs).

### 5. `src/app/api/leads/route.ts:392` — direct `.delete()`

`supabase.from('manifests').delete().in('lead_id', ids)` — bulk delete with no audit trail.

**Fix:** either route through an explicit `deleteManifestsForLeads(leadIds, reason)` helper that records the deletion in `manifest_history`, or add `manifest_migrator`-role-only grant as the only path that can delete. Deletes must leave a paper trail.

---

## The 1 doctrine violation — also Phase 5 (or earlier)

### `src/app/api/manifests/[id]/route.ts:78` — `deepMerge` inside the callback

```ts
const cascaded = await updateManifestAndCascade(leadId, (manifest: any) => {
  const merged = deepMerge(manifest, manifestUpdates)
  Object.assign(manifest, merged)
  // ...
})
```

Routed through the canonical function (Bucket C) but the callback does exactly what doctrine forbids: a deep merge of caller input into the existing manifest. File 05 line 67 names this as "WRONG — causes nesting." This is the smoking gun for the `manifest.manifest.*` bug baseline found on 2 rows.

**Fix:** replace the callback body with shallow per-subtree replacement:

```ts
for (const [key, value] of Object.entries(manifestUpdates)) {
  manifest[key] = value
}
```

The Phase 3 hardening of `updateManifestAndCascade` itself (Zod validate, strip derived fields, ban deep merge inside the function) will also need a parity change that makes deep-merge *in the callback* impossible — ideally by changing the function signature from `(leadId, mutatorFn)` to `(leadId, { subtrees, actor, reason })` so the caller can't even express a deep merge. That's a Phase 3 API change, not a bypass close. Flag for Phase 3.

---

## The 10 legitimate through-path writes (Bucket C)

All already route via `updateManifestAndCascade`. No refactor needed; Phase 3 will retroactively add Zod validation, history writes, and derived-field stripping that these callers inherit automatically.

| File | Line |
|---|---|
| `src/app/api/mojo/sync/route.ts` | 913 |
| `src/app/api/mojo/sync/route.ts` | 921 |
| `src/app/api/mojo/sync/route.ts` | 1045 |
| `src/app/api/mojo/sync/route.ts` | 1187 |
| `src/app/api/mojo/reprocess/route.ts` | 171 |
| `src/app/api/ari/generate-briefing/route.ts` | 373 |
| `src/app/api/admin/fix-orphans/route.ts` | 90 |
| (plus 3 others surfaced via `updateManifestAndCascade` grep that don't directly `.from('manifests')`) | — |

Additional call sites that import `updateManifestAndCascade` without a colocated `.from('manifests')` (also Bucket C, verified by grep):

- `src/lib/auto-enrich.ts` (5 callsites)
- `src/lib/stage-logic.ts` (3 callsites)
- `src/lib/ghost-protocol-pipeline.ts` (1)
- `src/lib/ghost-protocol-appointment.ts` (3)
- `src/lib/pipeline-auto-advance.ts` (1)
- `src/app/api/book/route.ts` (1)
- `src/app/api/enrich-redfin/route.ts` (1)
- `src/app/api/enrich-zillow/route.ts` (1 via helper `updateManifestWithZillow`)
- `src/app/api/enrich/route.ts` (1 via helper `updateManifest`)
- `src/app/api/ivr/handle-input/route.ts` (1)
- `src/app/api/ivr/after-record/route.ts` (2)
- `src/app/api/ivr/voicemail-recording/route.ts` (1)
- `src/app/api/ivr/cold-no-input/route.ts` (1)
- `src/app/api/twilio-recording-callback/route.ts` (1)
- `src/app/api/twilio-sms-webhook/route.ts` (4)
- `src/app/api/leads/route.ts` (3)
- `src/app/api/leads/appointment-outcome/route.ts` (1)
- `src/app/api/leads/create-appointment/route.ts` (1)
- `src/app/api/workers/appointment-reminder/route.ts` (4)

All inherit Phase 3 hardening automatically.

---

## The 6 Bucket A lines (the write path itself)

These are the internals of `src/lib/manifest-sync.ts`. Audited separately in Phase 3.

| Line | Function | Purpose |
|---|---|---|
| 56 | `getManifestForLead` | read |
| 82 | `saveManifest` | **internal `.update()` — the canonical writer** |
| 141 | `getLeadIdForManifest` | read |
| 390 | `getManifestForLead` (error path) | read |
| 427 | `ensureManifestExists` | **internal `.insert()` — the canonical creator** |
| 442 | `ensureManifestExists` (dup check) | read |

Phase 3 checklist will verify:
1. `saveManifest` calls `manifestV2_1Schema.parse` on the payload (doesn't today — no schema existed).
2. `saveManifest` uses shallow subtree replacement, not deep merge (the current implementation needs inspection).
3. `saveManifest` writes a row to `manifest_history` (the table doesn't exist yet — created in Phase 4).
4. `saveManifest` strips derived fields (`hot_eligibility`, `completeness`, `next_action`) from caller payloads.
5. The whole thing runs inside a transaction (current implementation needs inspection).

---

## Per-file classification — full table

| File | Line | Bucket | Notes |
|---|---|---|---|
| src/lib/manifest-sync.ts | 56 | A | read in getManifestForLead |
| src/lib/manifest-sync.ts | 82 | A | internal `.update()` — canonical writer |
| src/lib/manifest-sync.ts | 141 | A | read in getLeadIdForManifest |
| src/lib/manifest-sync.ts | 390 | A | read (error path) |
| src/lib/manifest-sync.ts | 427 | A | internal `.insert()` — canonical creator |
| src/lib/manifest-sync.ts | 442 | A | read (dup check) |
| src/lib/prospect-to-lead.ts | 171 | **D** | direct `.insert()` bypass |
| src/lib/auto-enrich.ts | 59 | B | read |
| src/lib/auto-enrich.ts | 711 | B | read |
| src/lib/briefing-regen.ts | 53 | B | read |
| src/lib/ghost-protocol-appointment.ts | 74 | B | read |
| src/lib/agent-scorecard.ts | 317 | B | read |
| src/lib/operating-rhythm.ts | 582, 698, 797 | B | reads |
| src/lib/hot-engine/cache.ts | 57, 187, 443, 549 | B | reads |
| src/lib/hot-engine/cache.ts | 492 | **D** | direct `.update()` bypass |
| src/lib/agent-stats.ts | 307 | B | read |
| src/components/leads/discovery-questions.tsx | 238 | B | UI read |
| src/components/leads/pain-points.tsx | 160 | B | UI read |
| src/components/leads/contract-modal.tsx | 54 | B | UI read |
| src/components/leads/seller-goals.tsx | 242 | B | UI read |
| src/components/leads/favorite-or-fool.tsx | 358 | B | UI read |
| src/components/leads/sms-compose-modal.tsx | 136 | B | UI read |
| src/components/pipeline/kanban-board.tsx | 117 | B | UI read |
| src/app/(app)/opportunities/page-old.tsx | 143 | B | legacy UI read |
| src/app/api/manifests/[id]/route.ts | 23, 58, 104 | B | GET/PATCH reads |
| src/app/api/manifests/[id]/route.ts | 78 | **C-DOCTRINE-VIOLATION** | `updateManifestAndCascade` + `deepMerge` |
| src/app/api/manifests/route.ts | 26 | B | GET query |
| src/app/api/manifests/route.ts | 75 | **D** | direct `.insert()` bypass |
| src/app/api/manifests/route.ts | 136 | **D** | direct `.update()` bypass |
| src/app/api/mojo/sync/route.ts | 653, 673, 693, 720, 800, 900 | B | reads |
| src/app/api/mojo/sync/route.ts | 913, 921, 1045, 1187 | C | via updateManifestAndCascade |
| src/app/api/mojo/reprocess/route.ts | 27 | B | read |
| src/app/api/mojo/reprocess/route.ts | 171 | C | via updateManifestAndCascade |
| src/app/api/ari/generate-briefing/route.ts | 28, 99 | B | reads |
| src/app/api/ari/generate-briefing/route.ts | 373 | C | via updateManifestAndCascade |
| src/app/api/enrich-zillow/route.ts | 111, 150 | B | reads |
| src/app/api/workers/appointment-reminder/route.ts | 112 | B | read |
| src/app/api/ari/chat/route.ts | 35 | B | read |
| src/app/api/admin/fix-orphans/route.ts | 24 | B | read |
| src/app/api/admin/fix-orphans/route.ts | 90 | C | via updateManifestAndCascade |
| src/app/api/ari/next-action/route.ts | 37 | B | read |
| src/app/api/twilio-sms-webhook/route.ts | 190 | B | read |
| src/app/api/hot-opportunities/route.ts | 62 | B | read |
| src/app/api/admin/repair-mojo-leads/route.ts | 41 | B | read |
| src/app/api/ivr/voicemail-recording/route.ts | 195 | B | read |
| src/app/api/ivr/after-record/route.ts | 189 | B | read |
| src/app/api/enrich/batch/route.ts | 45 | B | read |
| src/app/api/enrich/route.ts | 60 | B | read |
| src/app/api/leads/route.ts | 392 | **D** | direct `.delete()` bypass |

---

## Gate status

- [x] Grep commands from file 05 Step 1 run.
- [x] Every hit in `src/` classified into A / B / C / D / C-doctrine-violation.
- [x] Table committed to `docs/manifest-write-audit-2026-04.md`.
- [ ] **Reviewed by Ernest before Phase 3.**

No code changed in Phase 2. Phases 3 and 5 execute against this audit.
