# 03 — Serializer Spec: `renderManifestForAri`

This is the only bridge between the stored manifest and Ari's context window. Build this right and the rest of the system inherits the benefits.

---

## Function signature

```typescript
// src/lib/manifest/render.ts
import type { ManifestV2_1, ManifestId } from './schema';

export type RenderIntent =
  | 'pre_call_briefing'
  | 'post_call_disposition'     // build later, not this phase
  | 'hot_opportunity_eval'      // build later, not this phase
  | 'daily_chief_of_staff';     // build later, not this phase

export interface RenderOptions {
  /** If set, serializer enriches from raw sources (calls, emails). Default: true for pre_call_briefing. */
  hydrate_sources?: boolean;
  /** Max tokens target. Serializer trims low-value sections to fit. Default: 1500. */
  token_budget?: number;
  /** For testing: freeze the clock. */
  now?: Date;
}

export async function renderManifestForAri(
  manifestId: ManifestId,
  intent: RenderIntent,
  options?: RenderOptions,
): Promise<string>;
```

**Invariants:**

1. Pure function. No writes. Ever.
2. Reads from `manifests`, optionally from `calls` and `email_messages` if `hydrate_sources` is true.
3. Output is valid Markdown. No JSON, no XML, no code fences around the briefing itself.
4. Output under `token_budget` (counted via `tiktoken` or equivalent).
5. Deterministic given the same inputs and `now`.

---

## Phase 1 scope: only `pre_call_briefing`

Do not build the other three intents. They will be specified separately once this one proves out.

---

## Markdown template for `pre_call_briefing`

The template uses a strict section order. Sections with no data are **omitted**, not rendered empty. The goal is a briefing Ari can consume fast and act on, not a complete data dump.

### Rendering rules

- **Headers:** H2 (`##`) for top-level sections. H3 (`###`) sparingly, only for subsections that contain lists.
- **Lists:** Hyphen bullets. No nested bullets beyond one level.
- **Emphasis:** Bold for the critical decision-driver in each section. Italics banned (Ari overweights them).
- **Numbers:** Always formatted (`$160,000` not `160000`). Dates as `Mon DD` format for anything within the current year, `Mon DD, YYYY` otherwise.
- **Null fields:** omit the line. Do not render "Not available."
- **Missing (key absent):** omit the line. Do not render "Not yet evaluated."
- **Pending:** render the section with the single line `_Evaluation in progress._`
- **Quotes:** each rendered as a blockquote with timestamp. Max 3 in the pre-call briefing even if 5 are stored.

### Template (annotated)

```markdown
# Pre-Call Briefing — {seller.full_name}

**Property:** {property.address_line_1}, {property.city}, {property.state} ({property.county} County)
**Station:** {pipeline.current_station} — Day {pipeline.days_in_current_station}
**Priority:** {pipeline.priority} | **Motivation:** {motivation.score}/10

---

## What to do on this call

**{next_action.description}**

{next_action.reasoning}

---

## Seller snapshot

- **{motivation.primary_driver}** (primary driver)
- Secondary: {motivation.secondary_drivers joined by ", "}
- Timeline: {situation.timeline_raw} ({situation.timeline_normalized_days} days)
- Life event: {situation.life_event_type}
- Personality: {personality.type}, {personality.communication_style}
- Best approach: **{personality.best_approach}**

---

## Financials at a glance

- Seller asking: **${financials.seller_asking_price}**
- Seller floor (our estimate): ${financials.seller_floor_price}
- Our max offer: ${financials.our_max_offer}
- Mortgage: ${financials.mortgage_balance}
- Back taxes: ${financials.back_taxes_owed}
- Estimated spread: **${financials.estimated_spread}** {"✓ clears $25K floor" if spread_meets_25k_floor else "✗ below $25K floor"}

---

## Open objections

- **[{category}]** {stated}
  ↳ {resolution_notes if addressed, else "Unaddressed."}

(Repeat per objection. Sorted: unaddressed first, then by severity if known.)

---

## Key leverage points

- {each item from situation.opportunity_flags}

---

## Red flags

- **[{severity}]** {label} — {notes}

(Omit section entirely if null or missing.)

---

## Voice of the seller

> "{quote}"
> — Call {relative date}, {timestamp if present}

(Max 3 quotes. Pick highest-signal ones — primary driver, urgency, trust-builder.)

---

## Context flags

- Last meaningful contact: {pipeline.last_meaningful_contact_at as "N days ago"}
- Next scheduled: {pipeline.next_scheduled_contact_at or "none scheduled"}
- Data completeness: {completeness.percent}% ({completeness.required_fields_present}/{completeness.required_fields_total})
- Missing: {completeness.missing_fields joined by ", "} (if any)
- Hot Opportunity verdict: {hot_eligibility.verdict}
  {if ineligible_data_gap:} — need: {missing_fields_for_gate}

---

## Briefing freshness

Generated at {now ISO}. Manifest updated {meta.updated_at relative}.
{"⚠️ Briefing flagged stale — verify critical fields before call." if meta.briefing_stale}
```

---

## Trimming rules when over token budget

If the rendered output exceeds `token_budget`, trim in this order until it fits. Never trim the first four sections (title, what-to-do, seller snapshot, financials).

1. Drop all but the top-severity red flag.
2. Drop all but 1 quote.
3. Drop the "Context flags" section.
4. Drop resolution notes on addressed objections.
5. Drop secondary drivers.
6. Last resort: drop the "Briefing freshness" section.

Log every trim with the manifest_id and the reason. Frequent trims signal bloated stored fields that need cleanup.

---

## Source hydration

When `hydrate_sources` is true and `sources.latest_call_id` is set:
- Fetch the latest call's summary (not transcript) from `calls.summary`.
- Fetch up to 3 most recent call timestamps and their dispositions.
- Use these to populate quote metadata and "last meaningful contact."

**Never** pull full transcripts into the briefing. If Ari needs transcript content, a separate tool call `getCallTranscript(call_id)` exists — that's a deliberate second-hop, not a default load.

---

## Implementation scaffolding

```typescript
// src/lib/manifest/render.ts
import { createClient } from '@/lib/supabase/server';
import { manifestV2_1Schema } from './schema';
import { renderPreCallBriefing } from './render.preCall';

export async function renderManifestForAri(
  manifestId: ManifestId,
  intent: RenderIntent,
  options: RenderOptions = {},
): Promise<string> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('manifests')
    .select('data')
    .eq('id', manifestId)
    .single();

  if (error || !data) {
    throw new ManifestNotFoundError(manifestId);
  }

  const manifest = manifestV2_1Schema.parse(data.data);

  switch (intent) {
    case 'pre_call_briefing':
      return renderPreCallBriefing(manifest, options);
    default:
      throw new Error(`Intent not yet implemented: ${intent}`);
  }
}
```

Split the per-intent renderers into their own files (`render.preCall.ts`) so each has clear ownership and tests.

---

## Tests required before shipping

See `08_TESTING_STRATEGY.md`, but at minimum:

- Snapshot test: 5 representative manifests → 5 rendered briefings. Commit the golden files. PR review catches regressions visually.
- Token budget test: every snapshot under 1500 tokens.
- Null/missing/pending test: one fixture with every optional field in each of the three states. Rendered output verified for each.
- Determinism test: same inputs + same `now` → byte-identical output.
