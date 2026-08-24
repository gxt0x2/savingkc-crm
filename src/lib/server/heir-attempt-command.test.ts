import { describe, expect, it } from 'vitest'

import { buildHeirAttemptCommand } from './heir-attempt-command'

describe('heir attempt commands', () => {
  it('normalizes bounded factual input', () => {
    expect(buildHeirAttemptCommand({
      prospect_phone_id: ' phone-1 ',
      disposition: 'callback',
      notes: ' Call Friday ',
      lead_id: ' lead-1 ',
      duration: 42.4,
      clientAttemptId: ' attempt-1 ',
    })).toEqual({
      ok: true,
      command: {
        prospectPhoneId: 'phone-1',
        disposition: 'callback_requested',
        notes: 'Call Friday',
        requestedLeadId: 'lead-1',
        requestedProspectId: null,
        campaignMemberId: null,
        durationSeconds: 42,
        markAsLead: false,
        verified: null,
        deadReason: null,
        appointmentAt: null,
        clientAttemptId: 'attempt-1',
        reached: true,
        dead: false,
      },
    })
  })

  it('preserves source prospect and campaign-member context', () => {
    expect(buildHeirAttemptCommand({
      prospect_phone_id: 'phone-1',
      prospect_id: ' prospect-1 ',
      campaign_member_id: ' member-1 ',
      disposition: 'no_answer',
    })).toMatchObject({
      ok: true,
      command: {
        requestedLeadId: null,
        requestedProspectId: 'prospect-1',
        campaignMemberId: 'member-1',
      },
    })
  })

  it('rejects invented dispositions instead of storing arbitrary strings', () => {
    expect(buildHeirAttemptCommand({
      prospect_phone_id: 'phone-1',
      disposition: 'seller_loves_us',
    })).toMatchObject({ ok: false })
  })

  it('accepts only governed dead reasons for dead outcomes', () => {
    expect(buildHeirAttemptCommand({
      prospect_phone_id: 'phone-1',
      disposition: 'dead',
      dead_reason: 'dnc',
    })).toMatchObject({ ok: true, command: { deadReason: 'dnc_refused', dead: true } })
    expect(buildHeirAttemptCommand({
      prospect_phone_id: 'phone-1',
      disposition: 'dead',
      dead_reason: 'made this up',
    })).toMatchObject({ ok: false })
  })

  it('requires a factual future time for an heir appointment', () => {
    const now = Date.parse('2026-08-23T12:00:00.000Z')
    expect(buildHeirAttemptCommand({
      prospect_phone_id: 'phone-1',
      disposition: 'appointment_set',
    }, now)).toMatchObject({ ok: false })
    expect(buildHeirAttemptCommand({
      prospect_phone_id: 'phone-1',
      disposition: 'appointment_set',
      appointmentAt: '2026-08-24T15:00:00.000Z',
    }, now)).toMatchObject({
      ok: true,
      command: { appointmentAt: '2026-08-24T15:00:00.000Z' },
    })
  })

  it('will not promote an heir that was not reached', () => {
    expect(buildHeirAttemptCommand({
      prospect_phone_id: 'phone-1',
      disposition: 'no_answer',
      mark_as_lead: true,
    })).toMatchObject({ ok: false })
  })
})
