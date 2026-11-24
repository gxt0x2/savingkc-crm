import { describe, expect, it } from 'vitest'
import { evaluateDialerCallPolicy } from '@/lib/dialer-call-policy'
import { campaignEndOpen, localTcpaWindowOpen, phoneCallSchedule, recipientCallWindowOpen } from '@/lib/calling/call-schedule'
import { exportBlockReason } from '@/lib/dialer-suppression-policy'

const centralMorning = new Date('2026-11-16T15:30:00.000Z')
const centralLateMorning = new Date('2026-11-16T17:00:00.000Z')
const afterCampaignEnd = new Date('2026-11-16T23:30:00.000Z')
const afterEasternLocalEnd = new Date('2026-11-17T02:30:00.000Z')

describe('recipient call schedule', () => {
  it('stamps earliest Central time from the area code', () => {
    expect(phoneCallSchedule('+18165550100')).toMatchObject({ callTz: 'central', earliestCallCt: '09:00' })
    expect(phoneCallSchedule('+19135550100')).toMatchObject({ callTz: 'central', earliestCallCt: '09:00' })
    expect(phoneCallSchedule('+13035550100')).toMatchObject({ callTz: 'mountain', earliestCallCt: '10:00' })
    expect(phoneCallSchedule('+12135550100')).toMatchObject({ callTz: 'pacific', earliestCallCt: '11:00' })
    expect(phoneCallSchedule('+18085550100')).toMatchObject({ callTz: 'hawaii', earliestCallCt: '13:00' })
    expect(phoneCallSchedule('+19995550100')).toMatchObject({ callTz: 'unknown', earliestCallCt: '11:00' })
  })

  it('fail-closes an unknown area code to 11:00 CT and does not use the property state', () => {
    expect(phoneCallSchedule('+19995550100')).toMatchObject({ callTz: 'unknown', earliestCallCt: '11:00' })
    expect(phoneCallSchedule('5550100')).toMatchObject({ callTz: 'unknown', earliestCallCt: '11:00' })
  })

  it('keeps an unknown area code inside every mapped zone', () => {
    const unknown = phoneCallSchedule('+19995550100')
    const noonCentral = new Date('2026-11-16T18:00:00.000Z')
    const halfPastNineEastern = new Date('2026-11-17T02:30:00.000Z')
    expect(localTcpaWindowOpen(unknown, noonCentral)).toBe(true)
    expect(localTcpaWindowOpen(unknown, halfPastNineEastern)).toBe(false)
    expect(evaluateDialerCallPolicy({ ...clean('+19995550100', noonCentral), surface: 'crm' }).allowed).toBe(true)
    expect(evaluateDialerCallPolicy({
      ...clean('+19995550100', halfPastNineEastern),
      surface: 'crm',
      callingHoursExempt: true,
    })).toMatchObject({ allowed: false, reason: 'outside_calling_hours' })
    expect(evaluateDialerCallPolicy({
      ...clean('+18165550100', halfPastNineEastern),
      surface: 'crm',
    }).allowed).toBe(true)
  })

  it('places 614 and 716 in Eastern and the new Pacific overlays in Pacific', () => {
    for (const code of ['614', '716']) {
      expect(phoneCallSchedule(`+1${code}5550100`)).toMatchObject({ callTz: 'eastern', earliestCallCt: '09:00' })
    }
    for (const code of ['279', '341', '350', '820', '840']) {
      expect(phoneCallSchedule(`+1${code}5550100`)).toMatchObject({ callTz: 'pacific', earliestCallCt: '11:00' })
    }
  })

  it('keeps a Pacific number callable and closed before 11:00 CT', () => {
    const pacific = phoneCallSchedule('+12135550100')
    expect(recipientCallWindowOpen(pacific, centralMorning)).toBe(false)
    expect(recipientCallWindowOpen(pacific, centralLateMorning)).toBe(true)
    expect(recipientCallWindowOpen(phoneCallSchedule('+18165550100'), centralMorning)).toBe(true)
    expect(campaignEndOpen(afterCampaignEnd)).toBe(false)
    expect(recipientCallWindowOpen(phoneCallSchedule('+12125550100'), afterEasternLocalEnd)).toBe(false)
  })
})

describe('kansas and out-of-state eligibility', () => {
  const open = new Date('2026-11-16T17:30:00.000Z')

  it('dials a Kansas number and a Pacific number when TCPA is open', () => {
    expect(evaluateDialerCallPolicy(clean('+19135550123', open)).allowed).toBe(true)
    expect(evaluateDialerCallPolicy(clean('+12135550123', open)).allowed).toBe(true)
  })

  it('does not dial a Pacific number at 9:30am CT', () => {
    expect(evaluateDialerCallPolicy(clean('+12135550123', centralMorning))).toMatchObject({
      allowed: false,
      reason: 'outside_calling_hours',
    })
    expect(evaluateDialerCallPolicy(clean('+18165550123', afterCampaignEnd))).toMatchObject({
      allowed: false,
      reason: 'outside_calling_hours',
    })
  })

  it('still blocks do-not-call for Kansas and out-of-state numbers', () => {
    expect(evaluateDialerCallPolicy({
      ...clean('+19135550123', open),
      suppressionReasons: ['dnc'],
    })).toMatchObject({ allowed: false, reason: 'do_not_call' })
    expect(exportBlockReason('+12135550123', {
      county: 'Denver',
      phones: [{ phone: '+12135550123', relationship: 'owner', lastDisposition: 'dnc' }],
    })).toBe('prospect_dnc')
    expect(exportBlockReason('+18165550123', {
      county: 'Cass',
      phones: [{ phone: '+18165550123', relationship: 'owner', lastDisposition: 'no_answer' }],
    })).toBe('out_of_service_area')
  })
})

function clean(phone: string, now: Date) {
  return {
    phone,
    surface: 'prospecting' as const,
    now,
    leads: [],
    suppressionReasons: [],
    prospectPhones: [],
    activities: [],
    companyOwnedNumbers: [],
    teamNumbers: [],
  }
}
