# 06 — Execution Checklist

Work this list top to bottom. Do not skip phases. Each phase ends with a verification gate; do not proceed until green.

---

## Phase 0 — Environment and baseline

- [ ] Confirm repo is at a clean commit. No uncommitted work.
- [ ] Create branch: `feat/manifest-v2-1-refactor`.
- [ ] Verify local dev env runs: `npm run dev` returns a working app.
- [ ] Verify Supabase connection and that you can read `manifests` table.
- [ ] Run pre-migration counts (see `04_MIGRATION_PLAN.md` Pre-migration checks). Record baseline.
- [ ] Read `01_ARCHITECTURE_DOCTRINE.md` end to end. No skimming.

**Gate:** baseline numbers recorded in PR description.

---

## Phase 1 — Schema and types

- [ ] Create `src/lib/manifest/schema.ts` from the contents of `02_ZOD_SCHEMA_V2_1.md`.
- [ ] Export all branded ID types, enum schemas, subtree schemas, root schema, `ManifestV2_1` type.
- [ ] Add unit tests in `src/lib/manifest/schema.test.ts`:
  - Happy path: full valid manifest parses.
  - Each subtree: valid and invalid examples.
  - Empty array rejection.
  - Empty object rejection.
  - `"pending"` sentinel accepted where allowed, rejected where not.
  - Unknown fields rejected (strict mode).
- [ ] Run tests: `npm test -- schema.test`. All green.
- [ ] Commit: `feat(manifest): add V2.1 Zod schema`.

**Gate:** schema merged to branch, tests passing.

---

## Phase 2 — Write path audit (findings only, no fixes yet)

- [ ] Run the grep commands in `05_WRITE_PATH_AUDIT.md` Step 1.
- [ ] Produce the classification table (Step 2).
- [ ] Paste the table into PR description. Do not fix anything yet.

**Gate:** audit table posted. Reviewed by Ernest before Phase 3.

---

## Phase 3 — Fix `updateManifestAndCascade`

- [ ] Open the existing function. Locate it.
- [ ] Add `manifestV2_1Schema.parse(payload)` at the top (Step 3.1 of audit).
- [ ] Replace any deep-merge with shallow per-subtree replacement (Step 3.2).
- [ ] Strip derived fields from caller payloads: `hot_eligibility`, `completeness`, `next_action.description` (when the caller is not `ari`). Log a warning for each stripped field.
- [ ] Add write to `manifest_history` inside the transaction (Step 3.4).
- [ ] Recompute `pipeline.days_in_current_station` and `pipeline.disposition_history_count` from history (Step 3.5).
- [ ] Wrap everything in a transaction (Step 3.6).
- [ ] Unit tests in `src/lib/manifest/write.test.ts`:
  - Shallow replacement preserves unspecified subtrees.
  - Invalid payload rejected with `ManifestValidationError`.
  - Derived fields stripped from payload are logged.
  - History row written on success.
  - Transaction rolls back on history write failure.
- [ ] Commit: `fix(manifest): enforce single write path discipline`.

**Gate:** write path tests passing. No production deploy yet.

---

## Phase 4 — Database sibling tables and runtime guard

- [ ] Create migration file (Supabase migrations folder): `manifest_history` table (see `04_MIGRATION_PLAN.md` Phase B).
- [ ] Add `transcript_text` column to `calls` if missing.
- [ ] Create `assert_cascade_actor()` trigger (see `05_WRITE_PATH_AUDIT.md` Step 4).
- [ ] Update `updateManifestAndCascade` to set `app.write_path = 'cascade'` at transaction start.
- [ ] Test locally that direct writes via psql are rejected. Test that writes through the function succeed.
- [ ] Commit: `feat(db): add manifest_history and write-path guard`.

**Gate:** migrations apply clean on dev. Trigger verified.

---

## Phase 5 — Close write-path bypasses

- [ ] For each Bucket D entry from Phase 2 audit: refactor to call `updateManifestAndCascade`, or delete the code path if it is dead.
- [ ] Re-run the grep from Phase 2. Bucket D should be empty.
- [ ] Run the full test suite: `npm test`. All green.
- [ ] Commit per bypass closed so reviewers can audit per-change.

**Gate:** zero Bucket D entries remaining. Test suite green.

---

## Phase 6 — Build the serializer (pre-call briefing only)

- [ ] Create `src/lib/manifest/render.ts` with the signature from `03_SERIALIZER_SPEC.md`.
- [ ] Create `src/lib/manifest/render.preCall.ts` with the template rendering.
- [ ] Create 5 fixture files in `src/lib/manifest/__fixtures__/`:
  - `full.json` — every field populated.
  - `minimal.json` — only required fields.
  - `pending.json` — several fields in `"pending"` state.
  - `hot.json` — qualifies for Hot Opportunity.
  - `stale.json` — `briefing_stale: true`.
- [ ] Write snapshot tests in `src/lib/manifest/render.test.ts`:
  - Each fixture renders without throwing.
  - Each render under 1500 tokens (use `gpt-tokenizer` or equivalent).
  - Deterministic: same inputs + same `now` → byte-identical output.
  - Trimming kicks in when budget lowered.
- [ ] Review the 5 snapshot outputs visually. Adjust template if needed.
- [ ] Commit: `feat(manifest): add pre-call briefing serializer`.

**Gate:** 5 snapshots committed, review pass from Ernest.

---

## Phase 7 — Migration dry run

- [ ] Write migration scripts per `04_MIGRATION_PLAN.md`:
  - `scripts/migration/01_snapshot.sql`
  - `scripts/migration/02_extract_transcripts.ts`
  - `scripts/migration/03_transform.ts`
  - `scripts/migration/04_verify.ts`
- [ ] Run Phase A (snapshot) on dev DB.
- [ ] Run Phase B (tables) on dev DB.
- [ ] Run Phase C (transcript extraction) with `--dry-run` on dev DB. Review warnings.
- [ ] Run Phase D (transform) with `--dry-run` on dev DB. Review diff for 10 sample records manually.
- [ ] Fix any transform bugs. Re-dry-run until diff is clean.

**Gate:** dry-run diffs reviewed and signed off by Ernest.

---

## Phase 8 — Migration live on dev

- [ ] Run Phase C (transcript extraction) live on dev.
- [ ] Run Phase D (transform) live on dev in batches of 50.
- [ ] Run Phase F (verify) on dev.
- [ ] Smoke-test the app: load a few leads, trigger Ari, confirm briefings render.

**Gate:** all verification queries pass on dev. App works end-to-end.

---

## Phase 9a — Shadow render (dual output, no cutover)

**Goal:** render the new Markdown briefing alongside the old JSON prompt for a week of real traffic, log both, verify the new output is actually better before changing Ari's diet.

- [ ] At every Ari prompt-build site, add shadow rendering:
  ```typescript
  const manifest = await loadManifest(leadId);                              // existing path
  const markdownBriefing = await renderManifestForAri(row.id, 'pre_call_briefing');

  // Log both for analysis — do NOT change what goes into the prompt yet
  await logBriefingShadow({
    lead_id: leadId,
    manifest_id: row.id,
    json_length_chars: JSON.stringify(manifest).length,
    json_token_count: encode(JSON.stringify(manifest)).length,
    markdown_length_chars: markdownBriefing.length,
    markdown_token_count: encode(markdownBriefing).length,
    rendered_at: new Date().toISOString(),
  });

  // Prompt still uses the old JSON path
  const prompt = buildAriPromptLegacy(manifest);
  ```
- [ ] Let this run for 7 days (or 100 real Ari invocations, whichever is longer).
- [ ] At the end of the window, produce a report:
  - Token reduction distribution (p50, p95, max) — expected: 30-60% reduction.
  - Any renders that threw errors. Zero tolerance.
  - Any renders that exceeded the 1500-token budget. Zero tolerance.
  - Visual spot-check: pick 10 random rendered briefings. Ernest reads them. Are they decision-ready?
- [ ] Fix any bugs surfaced. Do not cut over until the report is clean.

**Gate:** shadow report reviewed by Ernest. Zero errors. Zero budget exceedances. Visual quality acceptable.

---

## Phase 9b — Ramped cutover

**Goal:** flip from JSON-in-prompt to Markdown-in-prompt gradually, with a kill switch.

- [ ] Add a feature flag: `ARI_BRIEFING_SOURCE` with values `json`, `markdown`, `percent:N`.
- [ ] At every Ari prompt-build site, consult the flag:
  ```typescript
  const useMarkdown = shouldUseMarkdown(leadId, flagValue);
  const prompt = useMarkdown
    ? `${ARI_SYSTEM_PROMPT_V3}\n\n${markdownBriefing}`
    : buildAriPromptLegacy(manifest);
  ```
  Where `shouldUseMarkdown` implements deterministic per-lead routing (hash the lead_id, modulo 100) so the same lead always gets the same treatment within a percentage tier.
- [ ] Roll the flag through stages, watching Ari output quality and error rates at each stage:
  - [ ] `percent:10` for 24 hours.
  - [ ] `percent:25` for 24 hours.
  - [ ] `percent:50` for 24 hours.
  - [ ] `percent:100` (equivalent to `markdown`).
- [ ] At each stage, monitor:
  - Error rate on Ari API calls.
  - Token usage per call.
  - Any user feedback / complaints from Ernest or Casey about briefing quality.
  - Count of Ari outputs that reference specific manifest details (sanity check: is Ari still using the data).
- [ ] If any metric regresses: set flag to `json` immediately. Do not proceed. Debug.

**Gate:** 24 hours at 100% with no regressions. Shadow logging can then be removed (Phase 11 cleanup).

---

## Phase 10 — Production migration

- [ ] Announce maintenance window (even if no downtime expected).
- [ ] Take production snapshot per Phase A.
- [ ] Apply Phase B migrations (tables, triggers).
- [ ] Deploy new code (write path, serializer, Ari wiring) behind a feature flag if possible.
- [ ] Run Phase C (transcript extraction) live on prod.
- [ ] Run Phase D (transform) live on prod, monitoring per batch.
- [ ] Run Phase F (verify) on prod. Zero failures required.
- [ ] Flip feature flag to 100%.
- [ ] Monitor error rates and Ari output for 24 hours.

**Gate:** 24 hours clean on production. No rollback triggered.

---

## Phase 11 — Cleanup

- [ ] Delete migration scripts from active path (keep in repo under `scripts/migration/archive/`).
- [ ] Remove any V2.0-era compatibility code from the write path.
- [ ] Update `docs/manifest.md` with the V2.1 contract.
- [ ] Update Ari Briefing System Prompt V3 to reflect that it now receives Markdown, not JSON.
- [ ] Add a note to `docs/manifest-write-audit-2026-04.md` marking the refactor complete.

**Gate:** PR merged to main. Changelog entry. Ernest signs off.

---

## Phase 12 — Set calendar reminder to drop backup

- [ ] Calendar event for May 18, 2026: review 30-day stability, then drop `manifests_backup_v2_0`.

---

## Do not attempt in this refactor

These are tempting but out of scope:

- Other serializer intents (`post_call_disposition`, `hot_opportunity_eval`, `daily_chief_of_staff`).
- Hot Opportunities scoring engine changes.
- UI changes to how manifests display.
- Schema V3 forward-thinking. V2.1 ships first.

Log anything you find here that wants fixing into a "follow-up" note in the PR. Do not scope-creep.
