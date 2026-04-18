import { describe, it, expect } from 'vitest'
import {
  manifestV2_1Schema,
  SellerSchema,
  PropertySchema,
  FinancialsSchema,
  SituationSchema,
  MotivationSchema,
  PersonalitySchema,
  PipelineSchema,
  HotEligibilitySchema,
  CompletenessSchema,
  NextActionSchema,
  SourcesSchema,
  MetaSchema,
  ContactIdSchema,
  CallIdSchema,
} from './schema'

const uuid = (seed: string) => `00000000-0000-4000-8000-${seed.padStart(12, '0')}`
const MANIFEST_ID = uuid('1')
const LEAD_ID = uuid('2')
const CONTACT_ID = uuid('3')
const CALL_ID = uuid('4')

const validSeller = {
  contact_id: CONTACT_ID,
  full_name: 'Jane Seller',
  phones: [{ number: '+18165551234', label: 'mobile', verified: true }],
  emails: null,
  preferred_channel: 'phone',
  best_time_to_reach: 'evenings after 6',
  spouse_or_co_decider: null,
}

const validProperty = {
  address_line_1: '123 Main St',
  address_line_2: null,
  city: 'Kansas City',
  state: 'MO',
  zip: '64110',
  county: 'Jackson',
  parcel_id: null,
  property_type: 'single_family',
  bedrooms: 3,
  bathrooms: 2,
  sqft: 1400,
  year_built: 1955,
  lot_size_sqft: 6500,
  condition: 'fair',
  occupancy: 'owner_occupied',
  known_issues: ['roof needs work'],
}

const validFinancials = {
  seller_asking_price: 180000,
  seller_floor_price: 150000,
  our_max_offer: 140000,
  mortgage_balance: 60000,
  back_taxes_owed: 0,
  liens_total: 0,
  estimated_arv: 220000,
  estimated_repair_cost: 35000,
  estimated_spread: 45000,
  spread_meets_25k_floor: true,
}

const validPipeline = {
  current_station: 'qualifying',
  priority: 'warm',
  entered_current_station_at: '2026-04-10T14:00:00.000Z',
  days_in_current_station: 8,
  last_meaningful_contact_at: '2026-04-15T18:30:00.000Z',
  next_scheduled_contact_at: null,
  disposition_history_count: 3,
}

const validCompleteness = {
  percent: 78,
  required_fields_total: 18,
  required_fields_present: 14,
  missing_fields: ['motivation.score', 'situation.timeline_normalized_days'],
  last_computed_at: '2026-04-18T12:00:00.000Z',
}

const validNextAction = {
  description: 'Call back Tuesday morning',
  owner: 'casey',
  due_by: '2026-04-22T14:00:00.000Z',
  category: 'outbound_call',
  reasoning: 'Seller asked for a callback after discussing with spouse',
}

const validSources = {
  call_ids: [CALL_ID],
  latest_call_id: CALL_ID,
  email_thread_ids: null,
  sms_thread_ids: null,
  enrichment_ids: null,
  manual_note_ids: null,
  all: [
    {
      id: CALL_ID,
      type: 'call',
      recorded_at: '2026-04-15T18:30:00.000Z',
      label: 'discovery call',
    },
  ],
}

const validMeta = {
  schema_version: '2.1',
  created_at: '2026-04-01T00:00:00.000Z',
  updated_at: '2026-04-18T12:00:00.000Z',
  last_actor: 'ari',
  briefing_stale: false,
}

const minimalValidManifest = {
  manifest_id: MANIFEST_ID,
  lead_id: LEAD_ID,
  seller: validSeller,
  property: validProperty,
  financials: validFinancials,
  pipeline: validPipeline,
  completeness: validCompleteness,
  next_action: validNextAction,
  sources: validSources,
  meta: validMeta,
}

describe('manifestV2_1Schema — root', () => {
  it('accepts a minimal valid manifest', () => {
    expect(() => manifestV2_1Schema.parse(minimalValidManifest)).not.toThrow()
  })

  it('accepts a full manifest with all optional subtrees populated', () => {
    const full = {
      ...minimalValidManifest,
      situation: {
        life_event_type: 'probate',
        blockers: null,
        timeline_raw: 'needs to close by end of summer',
        timeline_normalized_days: 90,
        objections: null,
        red_flags: null,
        opportunity_flags: null,
        price_expectations_raw: null,
      },
      motivation: {
        score: 7,
        score_reasoning: 'recent probate, clear timeline, engaged on calls',
        primary_driver: 'probate resolution',
        secondary_drivers: null,
        key_quotes: null,
        urgency_signals: ['mentioned closing date twice'],
      },
      personality: {
        type: 'analytical',
        communication_style: 'professional',
        best_approach: 'lead with numbers',
        rapport_notes: null,
        trust_level: 'medium',
      },
      hot_eligibility: {
        verdict: 'eligible',
        composite_score: 0.74,
        factors: {
          engagement: { raw_value: 5, weight: 0.25, normalized_contribution: 0.2 },
          velocity: { raw_value: 8, weight: 0.25, normalized_contribution: 0.22 },
          deal_quality: { raw_value: 45000, weight: 0.3, normalized_contribution: 0.2 },
          time_pressure: { raw_value: 90, weight: 0.2, normalized_contribution: 0.12 },
        },
        gates: {
          min_spread_25k_pass: true,
          data_completeness_pass: true,
          anti_flicker_cooldown_active: false,
          cooldown_expires_at: null,
        },
        missing_fields_for_gate: null,
        last_evaluated_at: '2026-04-18T12:00:00.000Z',
      },
    }
    expect(() => manifestV2_1Schema.parse(full)).not.toThrow()
  })

  it('rejects unknown top-level fields (strict mode)', () => {
    const withExtra = { ...minimalValidManifest, extraField: 'nope' }
    expect(() => manifestV2_1Schema.parse(withExtra)).toThrow()
  })

  it('rejects missing required subtree (seller)', () => {
    const { seller: _omit, ...rest } = minimalValidManifest
    expect(() => manifestV2_1Schema.parse(rest)).toThrow()
  })

  it('accepts next_action as the "pending" sentinel', () => {
    const withPending = { ...minimalValidManifest, next_action: 'pending' }
    expect(() => manifestV2_1Schema.parse(withPending)).not.toThrow()
  })

  it('rejects "pending" as an arbitrary string for a non-pendingOr field', () => {
    const bad = {
      ...minimalValidManifest,
      completeness: { ...validCompleteness, percent: 'pending' },
    }
    expect(() => manifestV2_1Schema.parse(bad)).toThrow()
  })
})

describe('empty-collection bans', () => {
  it('rejects empty array in situation.objections (nonEmptyArray)', () => {
    const bad = {
      ...minimalValidManifest,
      situation: {
        life_event_type: 'probate',
        blockers: null,
        timeline_raw: null,
        timeline_normalized_days: null,
        objections: [],
        red_flags: null,
        opportunity_flags: null,
        price_expectations_raw: null,
      },
    }
    expect(() => manifestV2_1Schema.parse(bad)).toThrow(/objections/i)
  })

  it('rejects empty array in completeness.missing_fields', () => {
    const bad = {
      ...minimalValidManifest,
      completeness: { ...validCompleteness, missing_fields: [] },
    }
    expect(() => manifestV2_1Schema.parse(bad)).toThrow(/missing_fields/i)
  })

  it('rejects empty object passed where PersonalitySchema is expected (strict)', () => {
    expect(() => PersonalitySchema.parse({})).toThrow()
  })

  it('rejects empty phones array on SellerSchema (nonEmptyArray)', () => {
    const bad = { ...validSeller, phones: [] }
    expect(() => SellerSchema.parse(bad)).toThrow()
  })

  it('rejects empty emails array on SellerSchema (must be null or non-empty)', () => {
    const bad = { ...validSeller, emails: [] }
    expect(() => SellerSchema.parse(bad)).toThrow()
  })

  it('rejects empty key_quotes array on MotivationSchema', () => {
    const bad = {
      score: 5,
      score_reasoning: 'test',
      primary_driver: 'test',
      secondary_drivers: null,
      key_quotes: [],
      urgency_signals: null,
    }
    expect(() => MotivationSchema.parse(bad)).toThrow()
  })

  it('rejects empty call_ids array on SourcesSchema (must be null or non-empty)', () => {
    const bad = {
      call_ids: [],
      latest_call_id: null,
      email_thread_ids: null,
      sms_thread_ids: null,
      enrichment_ids: null,
      manual_note_ids: null,
      all: null,
    }
    expect(() => SourcesSchema.parse(bad)).toThrow()
  })
})

describe('strict-mode discipline', () => {
  it('HotFactorSchema rejects unknown fields', () => {
    const bad = {
      raw_value: 5,
      weight: 0.25,
      normalized_contribution: 0.2,
      bonusField: 'nope',
    }
    expect(() => HotEligibilitySchema.parse({
      verdict: 'eligible',
      composite_score: 0.5,
      factors: {
        engagement: bad,
        velocity: { raw_value: 0, weight: 0.25, normalized_contribution: 0 },
        deal_quality: { raw_value: 0, weight: 0.25, normalized_contribution: 0 },
        time_pressure: { raw_value: 0, weight: 0.25, normalized_contribution: 0 },
      },
      gates: {
        min_spread_25k_pass: true,
        data_completeness_pass: true,
        anti_flicker_cooldown_active: false,
        cooldown_expires_at: null,
      },
      missing_fields_for_gate: null,
      last_evaluated_at: '2026-04-18T12:00:00.000Z',
    })).toThrow()
  })

  it('HotEligibility.gates rejects unknown fields', () => {
    const base = {
      verdict: 'eligible' as const,
      composite_score: 0.5,
      factors: {
        engagement: { raw_value: 0, weight: 0.25, normalized_contribution: 0 },
        velocity: { raw_value: 0, weight: 0.25, normalized_contribution: 0 },
        deal_quality: { raw_value: 0, weight: 0.25, normalized_contribution: 0 },
        time_pressure: { raw_value: 0, weight: 0.25, normalized_contribution: 0 },
      },
      gates: {
        min_spread_25k_pass: true,
        data_completeness_pass: true,
        anti_flicker_cooldown_active: false,
        cooldown_expires_at: null,
        extraGate: true,
      },
      missing_fields_for_gate: null,
      last_evaluated_at: '2026-04-18T12:00:00.000Z',
    }
    expect(() => HotEligibilitySchema.parse(base)).toThrow()
  })
})

describe('branded IDs', () => {
  it('ContactIdSchema rejects non-UUID', () => {
    expect(() => ContactIdSchema.parse('not-a-uuid')).toThrow()
  })

  it('ContactIdSchema accepts a valid UUID', () => {
    expect(() => ContactIdSchema.parse(CONTACT_ID)).not.toThrow()
  })

  it('CallIdSchema rejects the literal "pending" string (pendingOr is NOT applied to IDs)', () => {
    expect(() => CallIdSchema.parse('pending')).toThrow()
  })
})

describe('SellerSchema', () => {
  it('accepts valid seller', () => {
    expect(() => SellerSchema.parse(validSeller)).not.toThrow()
  })

  it('rejects missing full_name', () => {
    const { full_name: _, ...rest } = validSeller
    expect(() => SellerSchema.parse(rest)).toThrow()
  })

  it('rejects empty full_name', () => {
    expect(() => SellerSchema.parse({ ...validSeller, full_name: '' })).toThrow()
  })
})

describe('PropertySchema', () => {
  it('accepts valid property', () => {
    expect(() => PropertySchema.parse(validProperty)).not.toThrow()
  })

  it('rejects state outside MO/KS', () => {
    expect(() =>
      PropertySchema.parse({ ...validProperty, state: 'CA' }),
    ).toThrow()
  })

  it('rejects malformed zip', () => {
    expect(() =>
      PropertySchema.parse({ ...validProperty, zip: '641' }),
    ).toThrow()
  })

  it('accepts 9-digit zip+4 format', () => {
    expect(() =>
      PropertySchema.parse({ ...validProperty, zip: '64110-1234' }),
    ).not.toThrow()
  })
})

describe('FinancialsSchema', () => {
  it('accepts a negative spread (underwater deal — data, not error)', () => {
    expect(() =>
      FinancialsSchema.parse({ ...validFinancials, estimated_spread: -5000 }),
    ).not.toThrow()
  })

  it('rejects negative asking price', () => {
    expect(() =>
      FinancialsSchema.parse({ ...validFinancials, seller_asking_price: -1 }),
    ).toThrow()
  })
})

describe('SituationSchema', () => {
  it('accepts a situation with all flag arrays as null', () => {
    expect(() =>
      SituationSchema.parse({
        life_event_type: 'tired_landlord',
        blockers: null,
        timeline_raw: null,
        timeline_normalized_days: null,
        objections: null,
        red_flags: null,
        opportunity_flags: null,
        price_expectations_raw: null,
      }),
    ).not.toThrow()
  })

  it('rejects unknown life_event_type', () => {
    expect(() =>
      SituationSchema.parse({
        life_event_type: 'lottery_winner',
        blockers: null,
        timeline_raw: null,
        timeline_normalized_days: null,
        objections: null,
        red_flags: null,
        opportunity_flags: null,
        price_expectations_raw: null,
      }),
    ).toThrow()
  })
})

describe('MotivationSchema', () => {
  const base = {
    score: 6,
    score_reasoning: 'engaged and has a clear timeline',
    primary_driver: 'relocation for job',
    secondary_drivers: null,
    key_quotes: null,
    urgency_signals: null,
  }

  it('accepts score 0 and 10 inclusive', () => {
    expect(() => MotivationSchema.parse({ ...base, score: 0 })).not.toThrow()
    expect(() => MotivationSchema.parse({ ...base, score: 10 })).not.toThrow()
  })

  it('rejects score 11', () => {
    expect(() => MotivationSchema.parse({ ...base, score: 11 })).toThrow()
  })

  it('rejects more than 5 key_quotes', () => {
    const q = {
      quote: 'we need to move fast',
      source_call_id: CALL_ID,
      source_timestamp_seconds: 120,
    }
    expect(() =>
      MotivationSchema.parse({ ...base, key_quotes: [q, q, q, q, q, q] }),
    ).toThrow()
  })
})

describe('HotEligibilitySchema', () => {
  const base = {
    verdict: 'eligible' as const,
    composite_score: 0.7,
    factors: {
      engagement: { raw_value: 5, weight: 0.25, normalized_contribution: 0.2 },
      velocity: { raw_value: 8, weight: 0.25, normalized_contribution: 0.22 },
      deal_quality: { raw_value: 45000, weight: 0.3, normalized_contribution: 0.2 },
      time_pressure: { raw_value: 90, weight: 0.2, normalized_contribution: 0.12 },
    },
    gates: {
      min_spread_25k_pass: true,
      data_completeness_pass: true,
      anti_flicker_cooldown_active: false,
      cooldown_expires_at: null,
    },
    missing_fields_for_gate: null,
    last_evaluated_at: '2026-04-18T12:00:00.000Z',
  }

  it('accepts a full eligibility block', () => {
    expect(() => HotEligibilitySchema.parse(base)).not.toThrow()
  })

  it('rejects unknown verdict', () => {
    expect(() =>
      HotEligibilitySchema.parse({ ...base, verdict: 'maybe' }),
    ).toThrow()
  })

  it('rejects composite_score above 1', () => {
    expect(() =>
      HotEligibilitySchema.parse({ ...base, composite_score: 1.2 }),
    ).toThrow()
  })
})

describe('MetaSchema', () => {
  it('rejects schema_version other than literal "2.1"', () => {
    expect(() =>
      MetaSchema.parse({ ...validMeta, schema_version: '2.0' }),
    ).toThrow()
  })

  it('rejects non-ISO datetime in updated_at', () => {
    expect(() =>
      MetaSchema.parse({ ...validMeta, updated_at: 'April 18' }),
    ).toThrow()
  })
})

describe('PipelineSchema', () => {
  it('rejects negative days_in_current_station', () => {
    expect(() =>
      PipelineSchema.parse({ ...validPipeline, days_in_current_station: -1 }),
    ).toThrow()
  })

  it('rejects unknown station', () => {
    expect(() =>
      PipelineSchema.parse({ ...validPipeline, current_station: 'waffle' }),
    ).toThrow()
  })
})

describe('SourcesSchema', () => {
  it('accepts all arrays as null (no sources yet)', () => {
    expect(() =>
      SourcesSchema.parse({
        call_ids: null,
        latest_call_id: null,
        email_thread_ids: null,
        sms_thread_ids: null,
        enrichment_ids: null,
        manual_note_ids: null,
        all: null,
      }),
    ).not.toThrow()
  })
})

describe('NextActionSchema', () => {
  it('rejects unknown category', () => {
    expect(() =>
      NextActionSchema.parse({ ...validNextAction, category: 'ship_it' }),
    ).toThrow()
  })

  it('rejects empty description', () => {
    expect(() =>
      NextActionSchema.parse({ ...validNextAction, description: '' }),
    ).toThrow()
  })
})
