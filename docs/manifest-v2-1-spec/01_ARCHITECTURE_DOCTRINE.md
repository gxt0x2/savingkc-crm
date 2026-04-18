# 01 — Architecture Doctrine

This file defines the design principles. Every decision downstream is justified by one of these. If a line of code cannot be traced back to a principle here, it is probably wrong.

---

## Principle 1 — A manifest is canonical state. Nothing else.

A manifest holds the current, authoritative, derived-intelligence view of a single lead. It does not hold raw source material. It does not hold history. It does not hold audit logs.

**What a manifest IS:**
- The current pipeline station.
- The current motivation score and the reasoning behind it.
- The seller's personality profile as Ari currently understands it.
- The property snapshot.
- The financial snapshot (seller floor, asking, mortgage, spread).
- The situation summary (blockers, timeline, life event type).
- Open objections and red flags.
- Key leverage points.
- The next best action.
- Pointers (IDs) to raw sources: call IDs, thread IDs, enrichment IDs.

**What a manifest IS NOT:**
- A transcript container. Transcripts live in `calls.transcript_text` keyed by `call_id`.
- An email body container. Bodies live in `email_messages` keyed by `message_id`.
- A raw scrape dump. County data lives in `property_enrichments` keyed by `enrichment_id`.
- An audit log. History lives in `manifest_history` with `manifest_id`, `updated_at`, `diff_jsonb`, `actor`, `reason`.
- A nested copy of itself. The current self-nesting (`manifest.manifest.owner`) is the bug this refactor kills.

**Why this matters:** the manifest gets loaded into Ari's context many times per day. Every byte of raw transcript in there is a byte stolen from actual reasoning tokens. Separation of concerns here is not aesthetic — it is token economics.

---

## Principle 2 — Ari never reads raw JSON. Ari reads a rendered briefing.

LLMs process Markdown better than JSON. Braces, quotes, and commas consume tokens without conveying meaning. Field names like `motivationScore` waste tokens that could be spent on actual context.

The serializer `renderManifestForAri(manifestId, intent)` is a pure function. It reads the manifest, queries any referenced raw sources that the intent requires, and emits a Markdown briefing tuned to the intent.

**Intents are first-class.** Ari does not have one job. It briefs before calls, it dispositions after calls, it evaluates Hot Opportunity eligibility, it generates daily chief-of-staff summaries. Each of these needs a different projection of the same underlying data.

**In this phase, build only `pre_call_briefing`.** Resist the urge to build all four. You will guess wrong on what the other three need and have to rewrite. Ship one, prove it, then expand.

---

## Principle 3 — Writes are atomic and validated. Reads are cheap.

`updateManifestAndCascade` is the sole sanctioned write path. It enforces:

1. **Zod validation before write.** If the incoming payload fails the schema, the write is rejected with a detailed error. There is no "best effort" write.
2. **Shallow replacement of subtrees.** Callers pass complete subtrees. If a caller wants to update `motivation.score` but preserve `motivation.reasoning`, they pass both. The function does not deep-merge — deep merge is what caused the current self-nesting.
3. **Append-only audit log.** Every successful write creates a row in `manifest_history`. The manifest itself does not grow with history.
4. **Deterministic computed fields.** On every write, the function recomputes `motivation_score`, `completeness_pct`, and `hot_eligibility.factors` from the canonical inputs. Callers cannot set these directly — attempts to do so are stripped with a warning.

Reads are dirt cheap: one Supabase `select` plus the serializer. No side effects. Ever. The serializer never writes.

---

## Principle 4 — Three states, three values.

The current manifest uses `[]`, `{}`, and missing keys interchangeably. Ari cannot distinguish "no red flags identified" from "red flags not yet evaluated." Fix at the schema layer:

| Meaning | Representation |
|---|---|
| Evaluated, no items found | `null` |
| Not yet evaluated | field omitted entirely (key missing) |
| In progress / pending further data | `"pending"` string sentinel |

**Empty arrays and empty objects are banned.** The Zod schema rejects them. This is enforced, not suggested.

The serializer renders each state differently in Markdown:
- `null` → "No red flags identified."
- missing → "Red flags: not yet evaluated."
- `"pending"` → "Red flags: evaluation in progress."
- non-empty array → actual list.

---

## Principle 5 — Hot Opportunity eligibility is visible in the manifest.

Currently you cannot tell from looking at a manifest whether it qualifies for Hot Opportunity top-tier labeling without running the scoring function. That is a leaky abstraction.

The manifest exposes a `hot_eligibility` block with:
- The four factor inputs (engagement, velocity, deal_quality, time_pressure), each with the raw value, the weight, and the normalized contribution.
- The $25K minimum spread check: pass/fail.
- The data completeness gate: pass/fail with which fields are missing.
- The 24-hour anti-flicker cooldown: active/inactive with timestamp.
- The final eligibility verdict: one of `eligible`, `ineligible_data_gap`, `ineligible_spread`, `ineligible_cooldown`, `ineligible_score`.

The Hot Opportunities engine still computes the final rank and decides which 4 get pinned. But the *inputs* are now transparent. Ari can explain to you why a lead is or isn't Hot without round-tripping to the scoring service.

---

## Principle 6 — Separate `sources` from `intelligence`.

Inside the manifest, raw-source pointers are one subtree, derived intelligence is another subtree. They never mix at the same level.

```
manifest
├── seller          (intelligence)
├── property        (intelligence)
├── financials      (intelligence)
├── situation       (intelligence)
├── motivation      (intelligence)
├── personality     (intelligence)
├── pipeline        (state)
├── hot_eligibility (derived)
├── completeness    (derived)
├── next_action     (derived)
├── sources         (pointers only — no content)
└── meta            (timestamps, version, actor)
```

Sources contains only IDs and minimal metadata (type, timestamp). It never contains transcripts, email bodies, or scraped HTML.

---

## Principle 7 — Adapt the spec to the repo, not the repo to the spec, unless doctrine says otherwise.

This spec was written without access to the actual codebase. Field names may not match. Table names may not match. Function signatures may not match.

**Rule:** where the repo differs from the spec in *naming*, adopt the repo's names. Where the repo differs from the spec in *doctrine* (e.g., multiple write paths, deep merging, embedded transcripts), fix the repo.

If you cannot tell which category a difference falls into, stop and ask. Silent wrong assumptions are the most expensive bugs in a refactor this deep.
