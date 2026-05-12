import { describe, it, expect } from 'vitest'
import type { ManifestV2 } from './manifest-builder'
import { triageLead, triageToCsvRow, TRIAGE_CSV_HEADER } from './lead-triage'

// ─── Fixture builder ─────────────────────────────────────────────────────────

function makeManifest(overrides: Partial<ManifestV2> = {}): ManifestV2 {
  const base: ManifestV2 = {
    manifestId: 'mf_test',
    version: 2,
    created: '2026-05-01T00:00:00Z',
    lastUpdated: '2026-05-01T00:00:00Z',
    lastUpdatedBy: 'test',
    source: 'mojo',
    currentStation: 'new',
    priority: 'cold',
    owner: {
      firstName: 'Test',
      lastName: 'Seller',
      fullName: 'Test Seller',
      phones: ['+18165551234'],
      emails: [],
    },
    situation: { type: [] },
    property: {},
    booking: {},
    deal: {},
    pipeline: {
      intake: { status: 'completed' },
      qualifying: { status: 'pending' },
      discovery: { status: 'pending' },
      research: { status: 'pending' },
      valuation: { status: 'pending' },
      offer: { status: 'pending' },
      negotiations: { status: 'pending' },
      contract: { status: 'pending' },
      inspection: { status: 'pending' },
      closing_prep: { status: 'pending' },
      closing: { status: 'pending' },
      closed: { status: 'pending' },
    },
    contacts: [],
    flags: {},
    notes: [],
    auditTrail: [],
    communications: { transcripts: [] },
  }
  // shallow merge plus deep for the few nested fields we mutate in tests
  return {
    ...base,
    ...overrides,
    situation: { ...base.situation, ...(overrides.situation ?? {}) },
    flags: { ...base.flags, ...(overrides.flags ?? {}) },
    communications: {
      transcripts: overrides.communications?.transcripts ?? base.communications!.transcripts,
      ...base.communications,
      ...(overrides.communications ?? {}),
    },
    pipeline: { ...base.pipeline, ...(overrides.pipeline ?? {}) },
    owner: { ...base.owner, ...(overrides.owner ?? {}) },
  }
}

// ─── DEAD verdicts ───────────────────────────────────────────────────────────

describe('triageLead — dead', () => {
  it('flags hard-no disposition as dead', () => {
    const m = makeManifest({
      communications: { transcripts: [], lastDisposition: 'not_interested' },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('dead')
    expect(r.reason).toBe('disposition_not_interested')
  })

  it('flags DNC request as dead', () => {
    const m = makeManifest({
      communications: { transcripts: [], lastDisposition: 'dnc' },
    })
    expect(triageLead(m).verdict).toBe('dead')
  })

  it('flags wrong number as dead', () => {
    const m = makeManifest({
      communications: { transcripts: [], lastDisposition: 'wrong_number' },
    })
    expect(triageLead(m).reason).toBe('disposition_wrong_number')
  })

  it('flags test phone pattern as dead', () => {
    const m = makeManifest({
      owner: {
        firstName: 'T', fullName: 'T', phones: ['+15555551212'], emails: [],
      },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('dead')
    expect(r.reason).toBe('test_phone')
  })

  it('flags <30s call with no signal as dead', () => {
    const m = makeManifest({
      communications: {
        lastDisposition: 'other',
        transcripts: [{
          id: 't1', date: '2026-05-01', duration: 12, agent: 'casey',
          recordingUrl: null, fullTranscript: 'um hello click', aiSummary: null,
        }],
      },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('dead')
    expect(r.reason).toBe('short_call_no_signal')
  })
})

// ─── KEEP verdicts ───────────────────────────────────────────────────────────

describe('triageLead — keep', () => {
  it('keeps appointment_set disposition', () => {
    const m = makeManifest({
      communications: { transcripts: [], lastDisposition: 'appointment_set' },
    })
    expect(triageLead(m).verdict).toBe('keep')
  })

  it('keeps high motivation score (>=60)', () => {
    const m = makeManifest({
      situation: { type: [], motivation: { score: 75 } },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('keep')
    expect(r.reason).toBe('high_motivation')
  })

  it('keeps under-contract leads untouched', () => {
    const m = makeManifest({
      currentStation: 'under_contract',
      communications: { transcripts: [], lastDisposition: 'not_interested' },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('keep')
    expect(r.reason).toBe('under_contract')
  })

  it('keeps lead with active appointment in pipeline', () => {
    const m = makeManifest({
      pipeline: {
        ...makeManifest().pipeline,
        appointment: {
          appointmentId: 'a1',
          type: 'phone_call',
          scheduledAt: '2026-05-20T16:00:00Z',
          createdAt: '2026-05-12T00:00:00Z',
          status: 'scheduled',
          confirmationCount: 0,
          lastSellerResponse: null,
          ghostRiskScore: 0,
          ghostProtocolActive: false,
          automationLog: [],
          assignedTo: 'casey',
          address: null,
          notes: null,
        },
      },
    })
    expect(triageLead(m).reason).toBe('appointment_active')
  })

  it('keeps lead with foreclosure window', () => {
    const m = makeManifest({
      situation: { type: ['tax_delinquent'], timeline: { foreclosureWindowDays: 21 } },
    })
    expect(triageLead(m).reason).toBe('urgency_present')
  })

  it('keeps 3yr tax delinquent + engaged motivation', () => {
    const m = makeManifest({
      flags: { opportunityFlags: ['3yr_tax_delinquent'] },
      situation: { type: ['tax_delinquent'], motivation: { score: 35 } },
    })
    expect(triageLead(m).reason).toBe('tax_distress_with_engagement')
  })

  it('keeps advanced-stage lead', () => {
    const m = makeManifest({ currentStation: 'qualified' })
    expect(triageLead(m).reason).toBe('advanced_stage')
  })

  it('keeps already-dead lead without re-classifying', () => {
    const m = makeManifest({ currentStation: 'dead' })
    expect(triageLead(m).reason).toBe('already_terminal')
  })
})

// ─── PARK verdicts ───────────────────────────────────────────────────────────

describe('triageLead — park', () => {
  it('parks no-answer-only leads for 14 days', () => {
    const m = makeManifest({
      communications: { transcripts: [], lastDisposition: 'no_answer' },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('park')
    expect(r.reason).toBe('no_contact_only')
    expect(r.parkUntilDays).toBe(14)
  })

  it('parks voicemail-only leads', () => {
    const m = makeManifest({
      communications: { transcripts: [], lastDisposition: 'voicemail_left' },
    })
    expect(triageLead(m).verdict).toBe('park')
  })

  it('parks long lukewarm calls for 90 days', () => {
    const m = makeManifest({
      communications: {
        lastDisposition: 'other',
        transcripts: [{
          id: 't1', date: '2026-05-01', duration: 240, agent: 'casey',
          recordingUrl: 'r', fullTranscript: 'long but unmotivated',
          aiSummary: 'Lead picked up, talked for a while, no real selling motivation.',
          extractedData: { motivationScore: 25 },
        }],
      },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('park')
    expect(r.reason).toBe('long_call_low_motivation')
    expect(r.parkUntilDays).toBe(90)
  })

  it('parks "someday" leads for 180 days', () => {
    const m = makeManifest({
      situation: { type: [], timeline: { urgency: 'low' } },
    })
    const r = triageLead(m)
    expect(r.verdict).toBe('park')
    expect(r.reason).toBe('someday_timeline')
    expect(r.parkUntilDays).toBe(180)
  })
})

// ─── CSV emitter ─────────────────────────────────────────────────────────────

describe('triageToCsvRow', () => {
  it('emits a deterministic header', () => {
    expect(TRIAGE_CSV_HEADER.split(',')[0]).toBe('lead_id')
    expect(TRIAGE_CSV_HEADER.split(',')).toContain('verdict')
    expect(TRIAGE_CSV_HEADER.split(',')).toContain('transcript_summary')
  })

  it('escapes commas and quotes in transcript_summary', () => {
    const m = makeManifest({
      communications: {
        transcripts: [{
          id: 't1', date: '2026-05-01', duration: 180, agent: 'casey',
          recordingUrl: null, fullTranscript: null,
          aiSummary: 'Seller said: "we might sell, maybe, eventually".',
          extractedData: { motivationScore: 30 },
        }],
      },
    })
    const result = triageLead(m)
    const row = triageToCsvRow(
      { id: 'lead-1', full_name: 'Test', phone: '+18165551234', station: 'new', is_parked: false },
      result,
    )
    expect(row.startsWith('lead-1,')).toBe(true)
    expect(row).toContain('""we might sell')
  })
})
