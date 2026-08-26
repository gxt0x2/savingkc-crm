import { describe, expect, it } from 'vitest'
import {
  ProspectingCampaignInputError,
  type ProspectingCampaignDetail,
  copyProspectingCampaignSetup,
  editableProspectingCampaignSetup,
  isWithinProspectingWindow,
  nextProspectingWindow,
  parseCreateProspectingCampaignInput,
  parseLeadIds,
  parseProspectingDialerSessionSetup,
  renderProspectingTemplate,
} from './campaign-contract'

describe('prospecting campaign contract', () => {
  it('copies setup into a clean draft contract without audience or activity state', () => {
    const campaign: ProspectingCampaignDetail = {
      id: 'campaign-1', name: 'August Absentee', kind: 'sms' as const, status: 'active' as const, ownerEmail: 'ernest@savingkc.com', ownerName: 'Ernest', callerId: null, fromPhone: '+18163077835', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1, 2, 3, 4, 5, 6], perHour: 75, perDay: 500, createdAt: '2026-08-21T10:00:00.000Z', updatedAt: '2026-08-21T11:00:00.000Z', activatedAt: '2026-08-21T11:00:00.000Z', pausedAt: null, completedAt: null,
      steps: [{ id: 'step-1', position: 1, delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}' }],
      members: [{ id: 'member-1', subjectKind: 'lead', leadId: 'lead-1', prospectId: null, enrollmentSource: 'crm_lead', phone: '+18165550123', timezone: 'America/Chicago', status: 'active', suppressionReason: null, currentStepPosition: 1, nextActionAt: null, enrolledAt: '2026-08-21T10:30:00.000Z', readyContactCount: 1, suppressedContactCount: 0, lead: null }],
      stats: { total: 1, active: 1, needsReview: 0, suppressed: 0, replied: 0, completed: 0, sent: 0, delivered: 0, failed: 0 },
      operations: { queued: 0, processing: 0, nextActionAt: null, lastSentAt: null },
    }
    const copy = copyProspectingCampaignSetup(campaign)
    expect(copy).toEqual({ name: 'August Absentee copy', kind: 'sms', callerId: null, fromPhone: '+18163077835', defaultTimezone: 'America/Chicago', sendWindowStart: '09:00', sendWindowEnd: '19:00', sendDays: [1, 2, 3, 4, 5, 6], perHour: 75, perDay: 500, steps: [{ delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}' }] })
    expect(copy).not.toHaveProperty('members')
    expect(copy).not.toHaveProperty('stats')
    expect(copy.steps).not.toBe(campaign.steps)
    expect(editableProspectingCampaignSetup(campaign)).toEqual({ ...copy, name: 'August Absentee' })
  })

  it('accepts a bounded SMS sequence and normalizes its sender', () => {
    expect(parseCreateProspectingCampaignInput({
      name: 'August absentee owners',
      kind: 'sms',
      fromPhone: '(816) 307-7835',
      defaultTimezone: 'America/Chicago',
      sendWindowStart: '10:00',
      sendWindowEnd: '18:00',
      sendDays: [1, 2, 3, 4, 5],
      perHour: 75,
      perDay: 500,
      steps: [
        { delayMinutes: 0, bodyTemplate: 'Hi {{first_name}}, would you consider an offer?' },
        { delayMinutes: 1440, bodyTemplate: 'Just following up, {{first_name}}.' },
      ],
    })).toMatchObject({
      kind: 'sms',
      fromPhone: '+18163077835',
      callerId: null,
      sendWindowStart: '10:00',
      sendWindowEnd: '18:00',
      sendDays: [1, 2, 3, 4, 5],
      steps: [{ delayMinutes: 0 }, { delayMinutes: 1440 }],
    })
  })

  it('rejects an empty or reversed local send schedule', () => {
    const campaign = {
      name: 'Invalid schedule', kind: 'sms', fromPhone: '+18163077835',
      steps: [{ delayMinutes: 0, bodyTemplate: 'Hello' }],
    }
    expect(() => parseCreateProspectingCampaignInput({ ...campaign, sendDays: [] })).toThrow(/at least one send day/)
    expect(() => parseCreateProspectingCampaignInput({ ...campaign, sendWindowStart: '19:00', sendWindowEnd: '09:00' })).toThrow(/valid local-time window/)
  })

  it('requires a calling number for an honest dialer campaign', () => {
    expect(() => parseCreateProspectingCampaignInput({ name: 'Cold list', kind: 'dialer' }))
      .toThrowError(new ProspectingCampaignInputError('caller_id_required', 'Choose an approved calling number'))
  })

  it('requires a registered campaign sender even when the phone is syntactically valid', () => {
    expect(() => parseCreateProspectingCampaignInput({
      name: 'Unknown sender', kind: 'sms', fromPhone: '+19135550123',
      steps: [{ delayMinutes: 0, bodyTemplate: 'Hello' }],
    })).toThrow(/approved texting number/)
  })

  it('accepts only one to five designated cold-call caller IDs for a session', () => {
    expect(parseProspectingDialerSessionSetup({
      startBehavior: 'first_unworked',
      callerMode: 'rotation',
      callerIds: ['(816) 310-0845', '+18162538313'],
      ringCount: 5,
      notDialedHours: 72,
      notContactedHours: 168,
    })).toEqual({
      startBehavior: 'first_unworked',
      callerMode: 'rotation',
      callerIds: ['+18163100845', '+18162538313'],
      ringCount: 5,
      notDialedHours: 72,
      notContactedHours: 168,
    })
    expect(() => parseProspectingDialerSessionSetup({
      callerMode: 'static',
      callerIds: ['+18166088588'],
      ringCount: 7,
    })).toThrow(/only designated cold-call numbers/i)
    expect(() => parseProspectingDialerSessionSetup({
      callerMode: 'rotation',
      callerIds: Array.from({ length: 6 }, (_, index) => `+1816310084${index}`),
      ringCount: 7,
    })).toThrow(/between 1 and 5/i)
  })

  it('defaults safely without hiding fresh sellers', () => {
    expect(parseProspectingDialerSessionSetup({})).toMatchObject({
      startBehavior: 'resume',
      callerMode: 'static',
      callerIds: ['+18163100845'],
      ringCount: 7,
      notDialedHours: null,
      notContactedHours: null,
    })
  })

  it('renders both campaign and legacy variables and rejects unknown placeholders', () => {
    expect(renderProspectingTemplate(
      'Hi {{first_name}}, this is {{agent_name}} about {{property_address}}.',
      { fullName: 'Alex Seller', propertyAddress: '1 Main St', agentName: 'Casey' },
    )).toBe('Hi Alex, this is Casey about 1 Main St.')
    expect(renderProspectingTemplate('Hi {{mystery_field}}', { agentName: 'Casey' })).toBeNull()
  })

  it('rejects duplicate or malformed member ids', () => {
    const id = '11111111-1111-4111-8111-111111111111'
    expect(() => parseLeadIds([id, id])).toThrow(/valid contacts/)
    expect(() => parseLeadIds(['not-a-uuid'])).toThrow(/valid contacts/)
  })

  it('checks the member timezone instead of the server timezone', () => {
    const window = {
      timezone: 'America/Chicago',
      sendWindowStart: '09:00:00',
      sendWindowEnd: '19:00:00',
      sendDays: [1, 2, 3, 4, 5, 6],
    }
    expect(isWithinProspectingWindow(new Date('2026-08-21T15:00:00.000Z'), window)).toBe(true)
    expect(isWithinProspectingWindow(new Date('2026-08-22T01:00:00.000Z'), window)).toBe(false)
    expect(nextProspectingWindow(new Date('2026-08-22T01:00:00.000Z'), window).toISOString())
      .toBe('2026-08-22T14:00:00.000Z')
  })
})
