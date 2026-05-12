import { z } from 'zod'

// ─── Branded IDs ───────────────────────────────────────────────────────
const brandedId = <B extends string>(brand: B) =>
  z.string().uuid().brand<B>()

export const ManifestIdSchema = brandedId('ManifestId')
export const LeadIdSchema = brandedId('LeadId')
export const CallIdSchema = brandedId('CallId')
export const ThreadIdSchema = brandedId('ThreadId')
export const MessageIdSchema = brandedId('MessageId')
export const EnrichmentIdSchema = brandedId('EnrichmentId')
export const ContactIdSchema = brandedId('ContactId')

export type ManifestId = z.infer<typeof ManifestIdSchema>
export type LeadId = z.infer<typeof LeadIdSchema>
export type CallId = z.infer<typeof CallIdSchema>
export type ThreadId = z.infer<typeof ThreadIdSchema>
export type MessageId = z.infer<typeof MessageIdSchema>
export type EnrichmentId = z.infer<typeof EnrichmentIdSchema>
export type ContactId = z.infer<typeof ContactIdSchema>

// ─── Sentinels ─────────────────────────────────────────────────────────
export const pendingSentinel = z.literal('pending')
export type Pending = z.infer<typeof pendingSentinel>

// pendingOr is object/record-only by convention — see file 02 "pendingOr usage warning".
// Applying this to a branded ID or plain string would let the literal "pending" pass as a
// valid ID, silently corrupting downstream joins.
const pendingOr = <T extends z.ZodTypeAny>(schema: T) =>
  z.union([schema, pendingSentinel])

const nonEmptyArray = <T extends z.ZodTypeAny>(schema: T) =>
  z.array(schema).min(1)

// ─── Enums ─────────────────────────────────────────────────────────────
export const PipelineStationSchema = z.enum([
  'new',
  'contacted',
  'qualified',
  'appointment_set',
  'offer_made',
  'under_contract',
  'closed_won',
  'closed_lost',
  'dead',
])

export const ParkingSchema = z.object({
  is_parked: z.boolean().default(false),
  parked_at: z.string().datetime().nullable().optional(),
  parked_until: z.string().datetime().nullable().optional(),
  parked_reason: z.string().nullable().optional(),
}).optional()

export const PrioritySchema = z.enum(['hot', 'warm', 'cold', 'dead'])

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
])

export const PersonalityTypeSchema = z.enum([
  'driver',
  'analytical',
  'expressive',
  'accommodator',
  'mixed',
  'unknown',
])

export const CommunicationStyleSchema = z.enum([
  'terse',
  'open_expressive',
  'guarded',
  'rambling',
  'professional',
  'unknown',
])

export const HotEligibilityVerdictSchema = z.enum([
  'eligible',
  'ineligible_data_gap',
  'ineligible_spread',
  'ineligible_cooldown',
  'ineligible_score',
  'ineligible_priority',
])

export const SourceTypeSchema = z.enum([
  'call',
  'email_thread',
  'email_message',
  'sms_thread',
  'enrichment',
  'manual_note',
  'web_form',
])

// ─── Subtree: Seller ───────────────────────────────────────────────────
export const SellerSchema = z
  .object({
    contact_id: ContactIdSchema,
    full_name: z.string().min(1),
    phones: nonEmptyArray(
      z.object({
        number: z.string(),
        label: z.enum(['primary', 'mobile', 'work', 'home', 'other']),
        verified: z.boolean(),
      }),
    ),
    emails: nonEmptyArray(
      z.object({
        address: z.string().email(),
        label: z.enum(['primary', 'work', 'personal', 'other']),
        verified: z.boolean(),
      }),
    ).nullable(),
    preferred_channel: z.enum(['phone', 'sms', 'email']).nullable(),
    best_time_to_reach: z.string().nullable(),
    spouse_or_co_decider: z
      .object({
        name: z.string(),
        role: z.string(),
      })
      .nullable(),
  })
  .strict()

// ─── Subtree: Property ─────────────────────────────────────────────────
export const PropertySchema = z
  .object({
    address_line_1: z.string().min(1),
    address_line_2: z.string().nullable(),
    city: z.string().min(1),
    state: z.enum(['MO', 'KS']),
    zip: z.string().regex(/^\d{5}(-\d{4})?$/),
    county: z.enum(['Jackson', 'Clay', 'Platte', 'Wyandotte', 'Johnson']),
    parcel_id: z.string().nullable(),
    property_type: z.enum([
      'single_family',
      'duplex',
      'multi_family',
      'mobile',
      'land',
      'other',
      'unknown',
    ]),
    bedrooms: z.number().int().nonnegative().nullable(),
    bathrooms: z.number().nonnegative().nullable(),
    sqft: z.number().int().positive().nullable(),
    year_built: z
      .number()
      .int()
      .gte(1800)
      .lte(new Date().getFullYear())
      .nullable(),
    lot_size_sqft: z.number().positive().nullable(),
    condition: z
      .enum(['excellent', 'good', 'fair', 'poor', 'distressed', 'unknown'])
      .nullable(),
    occupancy: z
      .enum(['owner_occupied', 'tenant_occupied', 'vacant', 'unknown'])
      .nullable(),
    known_issues: nonEmptyArray(z.string()).nullable(),
  })
  .strict()

// ─── Subtree: Financials ───────────────────────────────────────────────
export const FinancialsSchema = z
  .object({
    seller_asking_price: z.number().int().positive().nullable(),
    seller_floor_price: z.number().int().positive().nullable(),
    our_max_offer: z.number().int().positive().nullable(),
    mortgage_balance: z.number().int().nonnegative().nullable(),
    back_taxes_owed: z.number().int().nonnegative().nullable(),
    liens_total: z.number().int().nonnegative().nullable(),
    estimated_arv: z.number().int().positive().nullable(),
    estimated_repair_cost: z.number().int().nonnegative().nullable(),
    estimated_spread: z.number().int().nullable(),
    spread_meets_25k_floor: z.boolean().nullable(),
  })
  .strict()

// ─── Subtree: Situation ────────────────────────────────────────────────
export const SituationSchema = z
  .object({
    life_event_type: LifeEventTypeSchema,
    blockers: nonEmptyArray(z.string()).nullable(),
    timeline_raw: z.string().nullable(),
    timeline_normalized_days: z.number().int().positive().nullable(),
    objections: nonEmptyArray(
      z.object({
        stated: z.string(),
        category: z.enum([
          'price',
          'timing',
          'trust',
          'logistics',
          'family',
          'other',
        ]),
        addressed: z.boolean(),
        resolution_notes: z.string().nullable(),
      }),
    ).nullable(),
    red_flags: nonEmptyArray(
      z.object({
        label: z.string(),
        severity: z.enum(['low', 'medium', 'high', 'critical']),
        notes: z.string().nullable(),
      }),
    ).nullable(),
    opportunity_flags: nonEmptyArray(
      z.object({
        label: z.string(),
        notes: z.string().nullable(),
      }),
    ).nullable(),
    price_expectations_raw: z.string().nullable(),
  })
  .strict()

// ─── Subtree: Motivation ───────────────────────────────────────────────
export const MotivationSchema = z
  .object({
    score: z.number().int().gte(0).lte(10),
    score_reasoning: z.string().min(1),
    primary_driver: z.string().min(1),
    secondary_drivers: nonEmptyArray(z.string()).nullable(),
    key_quotes: nonEmptyArray(
      z.object({
        quote: z.string().min(1),
        source_call_id: CallIdSchema,
        source_timestamp_seconds: z.number().int().nonnegative().nullable(),
      }),
    )
      .max(5)
      .nullable(),
    urgency_signals: nonEmptyArray(z.string()).nullable(),
  })
  .strict()

// ─── Subtree: Personality ──────────────────────────────────────────────
export const PersonalitySchema = z
  .object({
    type: PersonalityTypeSchema,
    communication_style: CommunicationStyleSchema,
    best_approach: z.string().nullable(),
    rapport_notes: z.string().nullable(),
    trust_level: z.enum(['low', 'medium', 'high', 'unknown']),
  })
  .strict()

// ─── Subtree: Pipeline ─────────────────────────────────────────────────
export const PipelineSchema = z
  .object({
    current_station: PipelineStationSchema,
    priority: PrioritySchema,
    entered_current_station_at: z.string().datetime(),
    days_in_current_station: z.number().int().nonnegative(),
    last_meaningful_contact_at: z.string().datetime().nullable(),
    next_scheduled_contact_at: z.string().datetime().nullable(),
    disposition_history_count: z.number().int().nonnegative(),
  })
  .strict()

// ─── Subtree: Hot Eligibility ──────────────────────────────────────────
export const HotFactorSchema = z
  .object({
    raw_value: z.number(),
    weight: z.number().min(0).max(1),
    normalized_contribution: z.number().min(0).max(1),
  })
  .strict()

export const HotEligibilitySchema = z
  .object({
    verdict: HotEligibilityVerdictSchema,
    composite_score: z.number().min(0).max(1),
    factors: z
      .object({
        engagement: HotFactorSchema,
        velocity: HotFactorSchema,
        deal_quality: HotFactorSchema,
        time_pressure: HotFactorSchema,
      })
      .strict(),
    gates: z
      .object({
        min_spread_25k_pass: z.boolean(),
        data_completeness_pass: z.boolean(),
        anti_flicker_cooldown_active: z.boolean(),
        cooldown_expires_at: z.string().datetime().nullable(),
      })
      .strict(),
    missing_fields_for_gate: nonEmptyArray(z.string()).nullable(),
    last_evaluated_at: z.string().datetime(),
  })
  .strict()

// ─── Subtree: Completeness ─────────────────────────────────────────────
export const CompletenessSchema = z
  .object({
    percent: z.number().int().min(0).max(100),
    required_fields_total: z.number().int().positive(),
    required_fields_present: z.number().int().nonnegative(),
    missing_fields: nonEmptyArray(z.string()).nullable(),
    last_computed_at: z.string().datetime(),
  })
  .strict()

// ─── Subtree: Next Action ──────────────────────────────────────────────
export const NextActionSchema = z
  .object({
    description: z.string().min(1),
    owner: z.enum(['ernest', 'casey', 'ari', 'system']),
    due_by: z.string().datetime().nullable(),
    category: z.enum([
      'outbound_call',
      'inbound_followup',
      'send_offer',
      'schedule_walkthrough',
      'send_contract',
      'collect_info',
      'nurture_touch',
      'close_out',
      'other',
    ]),
    reasoning: z.string().min(1),
  })
  .strict()

// ─── Subtree: Sources (pointers only) ──────────────────────────────────
export const SourcePointerSchema = z
  .object({
    id: z.string().uuid(),
    type: SourceTypeSchema,
    recorded_at: z.string().datetime(),
    label: z.string().nullable(),
  })
  .strict()

export const SourcesSchema = z
  .object({
    call_ids: nonEmptyArray(CallIdSchema).max(200).nullable(),
    latest_call_id: CallIdSchema.nullable(),
    email_thread_ids: nonEmptyArray(ThreadIdSchema).max(50).nullable(),
    sms_thread_ids: nonEmptyArray(ThreadIdSchema).max(50).nullable(),
    enrichment_ids: nonEmptyArray(EnrichmentIdSchema).max(20).nullable(),
    manual_note_ids: nonEmptyArray(z.string().uuid()).max(100).nullable(),
    all: nonEmptyArray(SourcePointerSchema).max(500).nullable(),
  })
  .strict()

// ─── Subtree: Meta ─────────────────────────────────────────────────────
export const MetaSchema = z
  .object({
    schema_version: z.literal('2.1'),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    last_actor: z.enum(['ernest', 'casey', 'ari', 'system', 'migration']),
    briefing_stale: z.boolean(),
  })
  .strict()

// ─── Root ──────────────────────────────────────────────────────────────
export const manifestV2_1Schema = z
  .object({
    manifest_id: ManifestIdSchema,
    lead_id: LeadIdSchema,

    seller: SellerSchema,
    property: PropertySchema,
    financials: FinancialsSchema,
    situation: SituationSchema.optional(),
    motivation: MotivationSchema.optional(),
    personality: PersonalitySchema.optional(),

    pipeline: PipelineSchema,
    parking: ParkingSchema,
    hot_eligibility: HotEligibilitySchema.optional(),
    completeness: CompletenessSchema,
    next_action: pendingOr(NextActionSchema),

    sources: SourcesSchema,
    meta: MetaSchema,
  })
  .strict()

export type ManifestV2_1 = z.infer<typeof manifestV2_1Schema>
