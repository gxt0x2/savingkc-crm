# Manifest V2.1 Refactor — Claude Code Handoff Package

**Owner:** Ernest A. Dodson III
**Repo:** `savingkc-crm` (local path: `/Users/ernestdodson/savingkc-crm`)
**Date prepared:** April 18, 2026
**Objective:** Refactor the `manifests` schema and introduce a Markdown serializer so Ari reads rendered briefings instead of raw JSON.

---

## Read these files in order

| # | File | Purpose |
|---|------|---------|
| 00 | `00_README_START_HERE.md` | This file. Orientation. |
| 01 | `01_ARCHITECTURE_DOCTRINE.md` | First-principles design. Read before writing code. |
| 02 | `02_ZOD_SCHEMA_V2_1.md` | The canonical contract. This is the source of truth. |
| 03 | `03_SERIALIZER_SPEC.md` | `renderManifestForAri` function design and Markdown templates. |
| 04 | `04_MIGRATION_PLAN.md` | How to move existing manifests to V2.1 without data loss. |
| 05 | `05_WRITE_PATH_AUDIT.md` | How to find and kill unauthorized writes to `manifests`. |
| 06 | `06_EXECUTION_CHECKLIST.md` | Phased task list. Check off as you go. |
| 07 | `07_ARI_PROMPT_INTEGRATION.md` | Where and how to wire Ari to the serializer. |
| 08 | `08_TESTING_STRATEGY.md` | Tests required before shipping each phase. |

---

## Non-negotiables

Before touching code, internalize these. They are derived from first principles and will not be relaxed.

1. **The manifest is canonical state. Nothing else.** Anything derivable from another source is not state — it is a view. Transcripts, emails, raw scraped county data, and audit logs live in their own tables. The manifest holds IDs that point to them.

2. **Ari never reads raw JSON.** Every place in the codebase where Ari's prompt is built currently reads the manifest directly — that call gets replaced with `renderManifestForAri(manifestId, intent)`. The serializer is the only bridge between storage and inference.

3. **`updateManifestAndCascade` is the sole write path.** Any other write to the `manifests` table is a bug. The write-path audit in file 05 finds them. They get deleted or refactored — not coexisting.

4. **Three states, three values.** `null` = evaluated, absent. `undefined` / missing key = not yet evaluated. Sentinel `"pending"` = in progress. Empty arrays and empty objects are banned at the schema level.

5. **Shallow replacement, never deep merge.** The current self-nesting bug is caused by deep merging objects on write. `updateManifestAndCascade` replaces whole subtrees. If the caller wants to preserve siblings, they must include them in the payload.

6. **Computed fields are pure functions.** `motivation_score`, `hot_score`, `completeness_pct` are recalculated on every write via deterministic functions. They are not stored and trusted — they are stored and verified.

---

## What you are NOT doing

- Not touching the UI.
- Not touching the Hot Opportunities scoring engine internals (only the inputs it reads).
- Not changing `calls`, `prospects`, or `prospect_phones` tables.
- Not introducing new dependencies unless listed in `02_ZOD_SCHEMA_V2_1.md`.
- Not building all four serializer intents upfront. Only `pre_call_briefing`. The others come after it proves out in production.

---

## Success criteria

- [ ] All existing manifests migrated to V2.1 with zero data loss (verified by diff).
- [ ] Zero self-nested `manifest.manifest.*` paths remain in the database.
- [ ] Zero embedded transcripts remain in the manifests table.
- [ ] Every Ari prompt build path calls `renderManifestForAri`, not `manifests.select('*')`.
- [ ] Pre-call briefing output is under 1500 tokens for p95 leads.
- [ ] All writes to `manifests` go through `updateManifestAndCascade`. Verified by grep and by a runtime assertion.
- [ ] Zod validation passes on 100% of migrated records.
- [ ] The manifest data gate for Hot Opportunity top-tier labeling reads from the new `hot_eligibility` block.

---

## If something is ambiguous

Stop. Post the question in the session. Do not guess. This refactor is architecture-critical — a silent wrong assumption compounds.

The spec assumes certain field names and table structures. Where the actual repo differs, **adapt the spec to the repo, not the repo to the spec**, unless the repo is wrong by the doctrine in file 01. When in doubt, flag it.

---

## Spec revision history

**Rev 2 — April 18, 2026 (current)**

Three corrections to the first draft, based on Ernest's review:

1. **Write-path guard rewritten.** The original GUC + trigger approach had two bugs on Supabase: `current_setting` is session-scoped and unreliable on transaction-pooled connections, and exempting `service_role` (which the app uses) would have made the trigger ceremonial. Replaced with role-based lockdown: revoke direct write GRANTs from `service_role`/`authenticated`, create a dedicated `cascade_writer` role, make `update_manifest_and_cascade` a `SECURITY DEFINER` function owned by that role, and keep the trigger as belt-and-suspenders checking `current_user` (which works on pooled connections). See file 05.

2. **Self-nesting collapse no longer blind.** The original `collapseSelfNesting` function preferred outer values on conflict, which could silently drop correct data when the deep-merge bug wrote truth to the inner path. Replaced with a conflict-detecting version that emits a per-field conflict report, requires a canary batch + manual review of ambiguous cases before full run, and throws on genuine scalar ambiguity rather than clobbering. See file 04.

3. **Ari cutover split into shadow + ramp.** The original Phase 9 was a big-bang flip of every prompt site. Replaced with Phase 9a (dual-render shadow week, logging both to compare quality and token usage) and Phase 9b (feature-flagged ramp at 10% → 25% → 50% → 100% with a kill switch). See file 06.

Minor corrections also applied: `pendingOr` usage warning added to file 02, `fast-json-patch` specified as the RFC 6902 generator in file 04, `completeness.percent` rationale added to file 02 (stored for query-index purposes, recomputed on every write to prevent drift).
