import { describe, it, expect } from 'vitest'
import { summarizeBulkSms, describeBulkResult, isWithinTextingHours, type BulkSmsItem } from './bulk-sms'

describe('summarizeBulkSms', () => {
  it('tallies statuses and skip reasons', () => {
    const items: BulkSmsItem[] = [
      { leadId: '1', status: 'sent' },
      { leadId: '2', status: 'sent' },
      { leadId: '3', status: 'skipped', reason: 'opted_out' },
      { leadId: '4', status: 'skipped', reason: 'duplicate' },
      { leadId: '5', status: 'skipped', reason: 'no_phone' },
      { leadId: '6', status: 'failed', error: 'twilio 21610' },
    ]
    const s = summarizeBulkSms(items)
    expect(s).toMatchObject({ total: 6, sent: 2, skipped: 3, failed: 1 })
    expect(s.breakdown).toEqual({ opted_out: 1, duplicate: 1, no_phone: 1, not_found: 0 })
  })

  it('describes a finished run', () => {
    const s = summarizeBulkSms([
      { leadId: '1', status: 'sent' },
      { leadId: '2', status: 'skipped', reason: 'opted_out' },
      { leadId: '3', status: 'failed', error: 'x' },
    ])
    expect(describeBulkResult(s)).toBe('1 sent · 1 skipped (1 opted out) · 1 failed')
  })
})

describe('isWithinTextingHours (America/Chicago, Mon–Sat 9–19)', () => {
  it('allows a weekday mid-afternoon CT', () => {
    // Tue 2026-06-02 18:00Z = 13:00 CDT
    expect(isWithinTextingHours(new Date('2026-06-02T18:00:00Z'))).toBe(true)
  })
  it('blocks late night CT', () => {
    // Tue 2026-06-02 04:00Z = 23:00 CDT Mon night
    expect(isWithinTextingHours(new Date('2026-06-02T04:00:00Z'))).toBe(false)
  })
  it('blocks early morning CT (before 9am)', () => {
    // 2026-06-02 12:00Z = 07:00 CDT
    expect(isWithinTextingHours(new Date('2026-06-02T12:00:00Z'))).toBe(false)
  })
  it('blocks Sunday', () => {
    // Sun 2026-06-07 18:00Z = 13:00 CDT Sunday
    expect(isWithinTextingHours(new Date('2026-06-07T18:00:00Z'))).toBe(false)
  })
})
