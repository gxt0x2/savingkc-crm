import { describe, expect, it } from 'vitest'
import {
  ProspectingCampaignInputError,
  isWithinProspectingWindow,
  nextProspectingWindow,
  parseCreateProspectingCampaignInput,
  parseLeadIds,
  renderProspectingTemplate,
} from './campaign-contract'

describe('prospecting campaign contract', () => {
  it('accepts a bounded SMS sequence and normalizes its sender', () => {
    expect(parseCreateProspectingCampaignInput({
      name: 'August absentee owners',
      kind: 'sms',
      fromPhone: '(816) 307-7835',
      defaultTimezone: 'America/Chicago',
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
      steps: [{ delayMinutes: 0 }, { delayMinutes: 1440 }],
    })
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
