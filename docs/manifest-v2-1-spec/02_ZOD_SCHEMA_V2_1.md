# 02 — Zod Schema V2.1

**File location in repo:** `src/lib/manifest/schema.ts` (adjust path to match repo conventions).
**Dependencies:** `zod@^3.23.0` (use whatever is already in `package.json`), `fast-json-patch@^3.1.x` (for `manifest_history.diff` as RFC 6902 patches).
**Export:** The `ManifestV2_1` type and the `manifestV2_1Schema` validator.

---

## Design decisions embedded in this schema

1. **Every field is either required, optional, or nullable. Explicitly.** No ambiguity.
2. **Empty arrays and empty objects are banned.** Use `null` or omit.
3. **Pending state is a first-class sentinel** for fields where "in progress" is a real possibility.
4. **Timestamps are ISO 8601 strings** at the schema boundary. Convert to Date only when needed.
5. **IDs are branded types** so a `CallId` cannot be accidentally passed where a `ManifestId` is expected.
6. **Subtrees are composable.** Each subtree has its own exported schema so tests and serializer templates can import just what they need.
7. **Derived fields (`completeness.percent`, `hot_eligibility.*`, `next_action.*`) are stored AND recomputed.** Stored so downstream queries can filter by them with an index (Hot Opportunities ranking needs this); recomputed on every write so they cannot drift from the source data. On writes, the stored value is always overwritten by the recomputation — callers cannot set these directly. The stored value is read-trustworthy but write-advisory.

### `pendingOr` usage warning

`pendingOr(schema)` produces `schema | "pending"`. **It must only be applied to object/record schemas, never to branded ID schemas or plain string schemas.** A branded ID type is structurally a string at runtime, so `pendingOr(CallIdSchema)` would accept the literal string `"pending"` as a valid call ID — that's a silent data corruption path. The schema below uses `pendingOr` only on `NextActionSchema` (an object). If you need to extend pending semantics to more fields, keep this rule.

---

## The full schema

```typescript
// src/lib/manifest/schema.ts
import { z } from 'zod';

// ─── Branded IDs ───────────────────────────────────────────────────────
const brandedId = <B extends string>(brand: B) =>
  z.string().uuid().brand<B>();

export const ManifestIdSchema    = brandedId('ManifestId');
export const LeadIdSchema        = brandedId('LeadId');
export const CallIdSchema        = brandedId('CallId');
export const ThreadIdSchema      = brandedId('ThreadId');
export const MessageIdSchema     = brandedId('MessageId');
export const EnrichmentIdSchema  = brandedId('EnrichmentId');
export const ContactIdSchema     = brandedId('ContactId');

export type ManifestId   = z.infer<typeof ManifestIdSchema>;
export type LeadId       = z.infer<typeof LeadIdSchema>;
export type CallId       = z.infer<typeof CallIdSchema>;
export type ThreadId     = z.infer<typeof ThreadIdSchema>;
export type MessageId    = z.infer<typeof MessageIdSchema>;
export type EnrichmentId = z.infer<typeof EnrichmentIdSchema>;
export type ContactId    = z.infer<typeof ContactIdSchema>;

// ─── Sentinels ─────────────────────────────────────────────────────────
export const pendingSentinel = z.literal('pending');
export type Pending = z.infer<typeof pendingSentinel>;

// Any field that can be "pending" uses this helper
const pendingOr = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, pendingSentinel]);

// Ban empty arrays and empty objects at the type level
const nonEmptyArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).min(1);

// ─── Enums ─────────────────────────────────────────────────────────────
export const PipelineStationSchema = z.enum([
  'new',
  'attempting_contact',
  'qualifying',
  'offer_prep',
  'offer_presented',
  'negotiating',
  'under_contract',
  'closing',
  'closed_won',
  'closed_lost',
  'dead',
  'nurture',
]);

export const PrioritySchema = z.enum(['hot', 'warm', 'cold', 'dead']);

export const LifeEventTypeSchema = z.enum([
  'probate',
  'divorce',
  'foreclosure',
  'tax_delinquency',
  'tired_landlord',
  'inheritance',
  'downsizing',
  'relocation',
  'financial_distress',
  'health',
  'other',
  'none',
]);

export const PersonalityTypeSchema = z.enum([
  'driver',
  'analytical',
  'expressive',
  'accommodator',
  'mixed',
  'unknown',
]);

export const CommunicationStyleSchema = z.enum([
  'terse',
  'open_expressive',
  'guarded',
  'rambling',
  'professional',
  'unknown',
]);

export const HotEligibilityVerdictSchema = z.enum([
  'eligible',
  'ineligible_data_gap',
  'ineligible_spread',
  'ineligible_cooldown',
  'ineligible_score',
  'ineligible_priority',
]);

export const SourceTypeSchema = z.enum([
  'call',
  'email_thread',
  'email_message',
  'sms_thread',
  'enrichment',
  'manual_note',
  'web_form',
]);

// ─── Subtree: Seller ───────────────────────────────────────────────────
export const SellerSchema = z.object({
  contact_id: ContactIdSchema,
  full_name: z.string().min(1),
  phones: nonEmptyArray(z.object({
    number: z.string(),   // E.164 format enforced at the contact layer
    label: z.enum(['primary', 'mobile', 'work', 'home', 'other']),
    verified: z.boolean(),
  })),
  emails: z.array(z.object({
    address: z.string().email(),
    label: z.enum(['primary', 'work', 'personal', 'other']),
    verified: z.boolean(),
  })).nullable(),   // null = no email on file, missing = not yet collected
  preferred_channel: z.enum(['phone', 'sms', 'email']).nullable(),
  best_time_to_reach: z.string().nullable(),   // free text, e.g. "evenings after 6"
  spouse_or_co_decider: z.object({
    name: z.string(),
    role: z.string(),
  }).nullable(),
}).strict();

// ─── Subtree: Property ─────────────────────────────────────────────────
export const PropertySchema = z.object({
  address_line_1: z.string().min(1),
  address_line_2: z.string().nullable(),
  city: z.string().min(1),
  state: z.enum(['MO', 'KS']),
  zip: z.string().regex(/^\d{5}(-\d{4})?$/),
  county: z.enum(['Jackson', 'Clay', 'Platte', 'Wyandotte', 'Johnson']),
  parcel_id: z.string().nullable(),
  property_type: z.enum([
    'single_family', 'duplex', 'multi_family', 'mobile', 'land', 'other', 'unknown',
  ]),
  bedrooms: z.number().int().nonnegative().nullable(),
  bathrooms: z.number().nonnegative().nullable(),
  sqft: z.number().int().positive().nullable(),
  year_built: z.number().int().gte(1800).lte(new Date().getFullYear()).nullable(),
  lot_size_sqft: z.number().positive().nullable(),
  condition: z.enum([
    'excellent', 'good', 'fair', 'poor', 'distressed', 'unknown',
  ]).nullable(),
  occupancy: z.enum(['owner_occupied', 'tenant_occupied', 'vacant', 'unknown']).nullable(),
  known_issues: nonEmptyArray(z.string()).nullable(),
}).strict();

// ─── Subtree: Financials ───────────────────────────────────────────────
export const FinancialsSchema = z.object({
  seller_asking_price: z.number().int().positive().nullable(),
  seller_floor_price: z.number().int().positive().nullable(),
  our_max_offer: z.number().int().positive().nullable(),
  mortgage_balance: z.number().int().nonnegative().nullable(),
  back_taxes_owed: z.number().int().nonnegative().nullable(),
  liens_total: z.number().int().nonnegative().nullable(),
  estimated_arv: z.number().int().positive().nullable(),
  estimated_repair_cost: z.number().int().nonnegative().nullable(),
  estimated_spread: z.number().int().nullable(),
  // spread can legitimately be negative on underwater deals; that is data, not an error

  // Derived. The caller must not set this. `updateManifestAndCascade` overwrites it.
  spread_meets_25k_floor: z.boolean().nullable(),
}).strict();

// ─── Subtree: Situation ────────────────────────────────────────────────
export const SituationSchema = z.object({
  life_event_type: LifeEventTypeSchema,
  blockers: nonEmptyArray(z.string()).nullable(),
  timeline_raw: z.string().nullable(),                       // what the seller said
  timeline_normalized_days: z.number().int().positive().nullable(),
  objections: nonEmptyArray(z.object({
    stated: z.string(),
    category: z.enum(['price', 'timing', 'trust', 'logistics', 'family', 'other']),
    addressed: z.boolean(),
    resolution_notes: z.string().nullable(),
  })).nullable(),
  red_flags: nonEmptyArray(z.object({
    label: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    notes: z.string().nullable(),
  })).nullable(),
  opportunity_flags: nonEmptyArray(z.object({
    label: z.string(),
    notes: z.string().nullable(),
  })).nullable(),
  price_expectations_raw: z.string().nullable(),
}).strict();

// ─── Subtree: Motivation ───────────────────────────────────────────────
export const MotivationSchema = z.object({
  score: z.number().int().gte(0).lte(10),      // derived; caller cannot set
  score_reasoning: z.string().min(1),
  primary_driver: z.string().min(1),
  secondary_drivers: nonEmptyArray(z.string()).nullable(),
  key_quotes: z.array(z.object({
    quote: z.string().min(1),
    source_call_id: CallIdSchema,
    source_timestamp_seconds: z.number().int().nonnegative().nullable(),
  })).max(5).nullable(),   // cap at 5 quotes. More is noise.
  urgency_signals: nonEmptyArray(z.string()).nullable(),
}).strict();

// ─── Subtree: Personality ──────────────────────────────────────────────
export const PersonalitySchema = z.object({
  type: PersonalityTypeSchema,
  communication_style: CommunicationStyleSchema,
  best_approach: z.string().nullable(),
  rapport_notes: z.string().nullable(),
  trust_level: z.enum(['low', 'medium', 'high', 'unknown']),
}).strict();

// ─── Subtree: Pipeline ─────────────────────────────────────────────────
export const PipelineSchema = z.object({
  current_station: PipelineStationSchema,
  priority: PrioritySchema,
  entered_current_station_at: z.string().datetime(),
  days_in_current_station: z.number().int().nonnegative(),
  last_meaningful_contact_at: z.string().datetime().nullable(),
  next_scheduled_contact_at: z.string().datetime().nullable(),
  disposition_history_count: z.number().int().nonnegative(),
  // History itself lives in manifest_history, not here
}).strict();

// ─── Subtree: Hot Eligibility ──────────────────────────────────────────
export const HotFactorSchema = z.object({
  raw_value: z.number(),
  weight: z.number().min(0).max(1),
  normalized_contribution: z.number().min(0).max(1),
});

export const HotEligibilitySchema = z.object({
  verdict: HotEligibilityVerdictSchema,
  composite_score: z.number().min(0).max(1),
  factors: z.object({
    engagement: HotFactorSchema,
    velocity: HotFactorSchema,
    deal_quality: HotFactorSchema,
    time_pressure: HotFactorSchema,
  }),
  gates: z.object({
    min_spread_25k_pass: z.boolean(),
    data_completeness_pass: z.boolean(),
    anti_flicker_cooldown_active: z.boolean(),
    cooldown_expires_at: z.string().datetime().nullable(),
  }),
  missing_fields_for_gate: nonEmptyArray(z.string()).nullable(),
  last_evaluated_at: z.string().datetime(),
}).strict();

// ─── Subtree: Completeness ─────────────────────────────────────────────
export const CompletenessSchema = z.object({
  percent: z.number().int().min(0).max(100),
  required_fields_total: z.number().int().positive(),
  required_fields_present: z.number().int().nonnegative(),
  missing_fields: nonEmptyArray(z.string()).nullable(),
  last_computed_at: z.string().datetime(),
}).strict();

// ─── Subtree: Next Action ──────────────────────────────────────────────
export const NextActionSchema = z.object({
  description: z.string().min(1),
  owner: z.enum(['ernest', 'casey', 'ari', 'system']),
  due_by: z.string().datetime().nullable(),
  category: z.enum([
    'outbound_call', 'inbound_followup', 'send_offer', 'schedule_walkthrough',
    'send_contract', 'collect_info', 'nurture_touch', 'close_out', 'other',
  ]),
  reasoning: z.string().min(1),
}).strict();

// ─── Subtree: Sources (pointers only) ──────────────────────────────────
export const SourcePointerSchema = z.object({
  id: z.string().uuid(),
  type: SourceTypeSchema,
  recorded_at: z.string().datetime(),
  label: z.string().nullable(),
}).strict();

export const SourcesSchema = z.object({
  call_ids: z.array(CallIdSchema).max(200).nullable(),
  latest_call_id: CallIdSchema.nullable(),
  email_thread_ids: z.array(ThreadIdSchema).max(50).nullable(),
  sms_thread_ids: z.array(ThreadIdSchema).max(50).nullable(),
  enrichment_ids: z.array(EnrichmentIdSchema).max(20).nullable(),
  manual_note_ids: z.array(z.string().uuid()).max(100).nullable(),
  all: z.array(SourcePointerSchema).max(500).nullable(),
  // `all` is a denormalized, chronological projection for the serializer.
  // Kept bounded; older entries roll off to a `sources_archive` if needed.
}).strict();

// ─── Subtree: Meta ─────────────────────────────────────────────────────
export const MetaSchema = z.object({
  schema_version: z.literal('2.1'),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  last_actor: z.enum(['ernest', 'casey', 'ari', 'system', 'migration']),
  briefing_stale: z.boolean(),
  // If true, Ari's next read should trigger a re-brief before use.
}).strict();

// ─── Root ──────────────────────────────────────────────────────────────
export const manifestV2_1Schema = z.object({
  manifest_id: ManifestIdSchema,
  lead_id: LeadIdSchema,

  seller: SellerSchema,
  property: PropertySchema,
  financials: FinancialsSchema,
  situation: SituationSchema.optional(),        // optional = not yet evaluated
  motivation: MotivationSchema.optional(),
  personality: PersonalitySchema.optional(),

  pipeline: PipelineSchema,
  hot_eligibility: HotEligibilitySchema.optional(),
  completeness: CompletenessSchema,
  next_action: pendingOr(NextActionSchema),

  sources: SourcesSchema,
  meta: MetaSchema,
}).strict();

export type ManifestV2_1 = z.infer<typeof manifestV2_1Schema>;
```

---

## Database column mapping

Assume the `manifests` table has:

| Column | Type | Source |
|---|---|---|
| `id` | uuid | `manifest_id` |
| `lead_id` | uuid (unique) | `lead_id` |
| `data` | jsonb | the full V2.1 object |
| `schema_version` | text | redundant pointer, indexed |
| `updated_at` | timestamptz | mirrors `meta.updated_at` |
| `priority` | text | mirrors `pipeline.priority`, indexed |
| `current_station` | text | mirrors `pipeline.current_station`, indexed |
| `is_hot_eligible` | boolean | mirrors `hot_eligibility.verdict === 'eligible'`, indexed |

The top-level columns are denormalized for query performance. They are written by `updateManifestAndCascade` atomically alongside the jsonb blob. Do not let callers write them directly.

---

## Enforcement

1. Export `manifestV2_1Schema.parse(payload)` at the top of `updateManifestAndCascade`.
2. On any validation error, log the payload (redacted), throw `ManifestValidationError` with the Zod issue tree. Do not soft-fail.
3. CI runs `manifestV2_1Schema.parse` over every migrated record. Any failure blocks deploy.
