import { describe, expect, it, vi } from 'vitest'
import {
  mapMojoDisposition,
  mergeMojoCallEvidence,
  mojoLifecycleTarget,
  normalizeMojoCallRecord,
  processCanonicalMojoCall,
  qualifyMojoCallRecord,
  runCanonicalMojoQueueWorker,
  type MojoCallIngestResult,
  type MojoCallRecord,
} from './mojo-call-import'

const call: MojoCallRecord = {
  record_id: 'mojo-123',
  contact_name: 'Seller Example',
  phone_number: '(913) 555-0123',
  property_address: '123 Main St',
  city: 'Kansas City',
  state: 'mo',
  zip: '64111',
  call_date: '2026-08-24T12:00:00Z',
  call_duration: 120,
  disposition: 'Callback requested',
  agent_name: 'Casey',
  notes: 'Seller asked for a callback.',
  follow_up_date: '2026-08-25T15:00:00Z',
}

function result(overrides: Partial<MojoCallIngestResult> = {}): MojoCallIngestResult {
  return {
    eventId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    leadId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    activityId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    outcome: 'callback_scheduled',
    normalizedPhone: '+19135550123',
    unresolvedReason: null,
    callAt: call.call_date,
    followUpAt: call.follow_up_date || null,
    station: 'new',
    assignedAgent: 'Casey',
    latestForLead: true,
    replayed: false,
    promotionEligible: true,
    qualificationStatus: 'eligible',
    qualificationReasons: ['minimum_duration_met'],
    ...overrides,
  }
}

describe('canonical Mojo call import', () => {
  it('normalizes provider facts without inventing CRM intelligence', () => {
    expect(normalizeMojoCallRecord({
      ...call,
      call_duration: 120.8,
      email: 'Primary@Example.com',
      emails: ['primary@example.com', ' Alternate@Example.com ', 'invalid'],
    })).toMatchObject({
      record_id: 'mojo-123',
      state: 'MO',
      call_duration: 120,
      call_date: '2026-08-24T12:00:00.000Z',
      follow_up_date: '2026-08-25T15:00:00.000Z',
      email: 'primary@example.com',
      emails: ['primary@example.com', 'alternate@example.com'],
    })
    expect(() => normalizeMojoCallRecord({ ...call, record_id: '' })).toThrow('invalid_record_id')
    expect(() => normalizeMojoCallRecord({ ...call, call_date: 'not-a-date' })).toThrow('invalid_call_date')
  })

  it('merges later Mojo email evidence without changing the primary email', () => {
    const merged = mergeMojoCallEvidence(
      { ...call, email: 'primary@example.com', emails: ['primary@example.com'] },
      { ...call, email: 'alternate@example.com', emails: ['alternate@example.com', 'third@example.com'] },
    )
    expect(merged.call.email).toBe('primary@example.com')
    expect(merged.call.emails).toEqual(['primary@example.com', 'alternate@example.com', 'third@example.com'])
    expect(merged.improved).toBe(true)
  })

  it.each([
    ['Appointment Set', 'appointment_set'],
    ['Motivated seller', 'meaningful_conversation'],
    ['Wrong Number', 'wrong_number'],
    ['Do Not Call', 'dnc'],
    ['Already sold', 'already_sold'],
    ['No answer', 'no_answer'],
  ] as const)('maps the human/provider disposition %s to %s', (disposition, outcome) => {
    expect(mapMojoDisposition(disposition)).toBe(outcome)
  })

  it('enforces the shared qualification policy before promotion', () => {
    expect(qualifyMojoCallRecord({
      ...call,
      call_duration: 30,
      recording_url: 'https://app71.mojosells.com/audio/short',
    })).toMatchObject({ assessment: { eligible: false, reasons: ['below_minimum_duration'] } })
  })

  it('merges a late recording into the idempotent queue payload', () => {
    const merged = mergeMojoCallEvidence(
      { ...call, call_duration: 0, recording_url: undefined },
      {
        ...call,
        call_duration: 180,
        recording_url: 'https://app71.mojosells.com/audio/late',
        notes: 'Motivation: retiring. Timeline: 60 days.',
      },
    )
    expect(merged).toMatchObject({
      improved: true,
      call: {
        call_duration: 180,
        recording_url: 'https://app71.mojosells.com/audio/late',
        promotion_eligible: true,
      },
    })
    expect(mergeMojoCallEvidence(merged.call, merged.call).improved).toBe(false)
  })

  it('preserves a governed qualification exception across later provider syncs', () => {
    const merged = mergeMojoCallEvidence(
      {
        ...call,
        recording_url: 'https://app71.mojosells.com/audio/howard',
        qualified_by_agent: true,
        qualification_override_reason: 'CRM owner approved the Howard exception.',
      },
      { ...call, recording_url: 'https://app71.mojosells.com/audio/howard' },
    )
    expect(merged.call).toMatchObject({
      qualified_by_agent: true,
      qualification_override_reason: 'CRM owner approved the Howard exception.',
    })
  })

  it('reactivates only a reasoned, promotion-eligible exception from Not Leads', () => {
    const dead = result({
      station: 'dead',
      promotionEligible: true,
      qualificationReasons: ['agent_qualified', 'negative_intent_overridden', 'minimum_duration_met'],
    })
    expect(mojoLifecycleTarget(dead, {
      ...call,
      qualified_by_agent: true,
      qualification_override_reason: 'CRM owner approved the Howard exception.',
    })).toEqual({ stage: 'contacted', deadReason: null })
    expect(mojoLifecycleTarget(dead, { ...call, qualified_by_agent: true })).toBeNull()
  })

  it('creates only the event-backed callback and governed lifecycle command', async () => {
    const dependencies = {
      ingest: vi.fn().mockResolvedValue(result()),
      suppressDnc: vi.fn(),
      createAppointment: vi.fn(),
      createFollowUp: vi.fn(),
      transitionLifecycle: vi.fn(),
      processRecordingEvidence: vi.fn(),
    }
    await expect(processCanonicalMojoCall(call, dependencies)).resolves.toMatchObject({
      outcome: 'callback_scheduled',
      leadId: result().leadId,
    })
    expect(dependencies.createFollowUp).toHaveBeenCalledOnce()
    expect(dependencies.createAppointment).not.toHaveBeenCalled()
    expect(dependencies.suppressDnc).not.toHaveBeenCalled()
    expect(dependencies.transitionLifecycle).toHaveBeenCalledOnce()
    expect(dependencies.processRecordingEvidence).toHaveBeenCalledOnce()
  })

  it('creates a scheduled callback for a searchable contact without promoting it to the pipeline', async () => {
    const dependencies = {
      ingest: vi.fn().mockResolvedValue(result({
        promotionEligible: false,
        qualificationStatus: 'ineligible',
        qualificationReasons: ['missing_seller_intent_evidence'],
      })),
      suppressDnc: vi.fn(),
      createAppointment: vi.fn(),
      createFollowUp: vi.fn(),
      transitionLifecycle: vi.fn(),
      processRecordingEvidence: vi.fn(),
    }
    await processCanonicalMojoCall(call, dependencies)
    expect(dependencies.createFollowUp).toHaveBeenCalledOnce()
    expect(dependencies.createAppointment).not.toHaveBeenCalled()
    expect(dependencies.transitionLifecycle).not.toHaveBeenCalled()
    expect(dependencies.processRecordingEvidence).not.toHaveBeenCalled()
  })

  it('persists DNC suppression even when the provider event cannot resolve a lead', async () => {
    const dnc = result({ leadId: null, activityId: null, outcome: 'dnc', unresolvedReason: 'unknown_contact' })
    const dependencies = {
      ingest: vi.fn().mockResolvedValue(dnc),
      suppressDnc: vi.fn().mockResolvedValue(undefined),
      createAppointment: vi.fn(),
      createFollowUp: vi.fn(),
      transitionLifecycle: vi.fn(),
      processRecordingEvidence: vi.fn(),
    }
    await processCanonicalMojoCall({ ...call, disposition: 'DNC request' }, dependencies)
    expect(dependencies.suppressDnc).toHaveBeenCalledWith('+19135550123')
    expect(dependencies.transitionLifecycle).not.toHaveBeenCalled()
  })

  it('finishes successes and durably releases failures for retry', async () => {
    const claims = [
      { id: 'queue-1', recordId: 'good', call: { ...call, record_id: 'good' }, attempts: 1 },
      { id: 'queue-2', recordId: 'bad', call: { ...call, record_id: 'bad' }, attempts: 1 },
    ]
    const finish = vi.fn()
      .mockResolvedValueOnce('completed')
      .mockResolvedValueOnce('pending')
    const worker = await runCanonicalMojoQueueWorker({
      claim: vi.fn().mockResolvedValue(claims),
      process: vi.fn()
        .mockResolvedValueOnce(result())
        .mockRejectedValueOnce(new Error('temporary failure')),
      finish,
    })
    expect(worker).toMatchObject({ claimed: 2, completed: 1, pending: 1, deadLetter: 0, failed: 0 })
    expect(finish).toHaveBeenNthCalledWith(1, expect.objectContaining({ queueId: 'queue-1', success: true }))
    expect(finish).toHaveBeenNthCalledWith(2, { queueId: 'queue-2', success: false, error: 'temporary failure' })
  })
})
