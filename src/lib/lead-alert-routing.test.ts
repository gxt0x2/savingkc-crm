import { describe, expect, it, vi } from 'vitest'
import { getLeadAlertRecipients, isCaseyLeadAlertWindow } from './lead-alert-routing'

describe('lead-alert-routing', () => {
  it('keeps Ernest on every new-lead alert 24/7', () => {
    vi.stubEnv('ERNEST_PHONE', '+18160000001')
    vi.stubEnv('CASEY_PHONE', '+18160000002')

    expect(getLeadAlertRecipients(new Date('2026-06-07T04:00:00.000Z'))).toEqual([
      { name: 'Ernest', phone: '+18160000001', schedule: '24_7' },
    ])
  })

  it('adds Casey only Monday through Friday from 9 to 5 Central time', () => {
    vi.stubEnv('ERNEST_PHONE', '+18160000001')
    vi.stubEnv('CASEY_PHONE', '+18160000002')

    expect(isCaseyLeadAlertWindow(new Date('2026-06-03T14:00:00.000Z'))).toBe(true)
    expect(getLeadAlertRecipients(new Date('2026-06-03T14:00:00.000Z')).map((recipient) => recipient.name)).toEqual([
      'Ernest',
      'Casey',
    ])

    expect(isCaseyLeadAlertWindow(new Date('2026-06-03T22:00:00.000Z'))).toBe(false)
    expect(isCaseyLeadAlertWindow(new Date('2026-06-06T16:00:00.000Z'))).toBe(false)
  })
})
