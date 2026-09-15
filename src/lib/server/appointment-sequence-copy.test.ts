import { describe, expect, it } from 'vitest'
import { appointmentCopy } from './appointment-sequence-copy'

const input = { firstName: 'Ernest Dodson', repName: 'Casey Davis', repPhone: '+18167277667', scheduledAt: '2026-09-16T22:00:00Z', bookedAt: '2026-09-14T18:00:00Z', type: 'in_person' }
describe('appointment seller copy', () => {
  it('uses the seller first name, rep identity, and Central appointment time', () => {
    const result = appointmentCopy({ ...input, touch: 'booking_sms' })
    expect(result.body).toContain("Hey Ernest, it's Casey")
    expect(result.body).toContain('5:00 PM CT')
    expect(result.body).not.toContain('Ernest Dodson')
  })
  it('asks for confirmation on same-day bookings without promising another morning text', () => {
    const result = appointmentCopy({ ...input, touch: 'booking_sms', bookedAt: '2026-09-16T18:00:00Z' })
    expect(result.body).toContain('Reply YES')
    expect(result.body).not.toContain('morning of')
  })
  it('does not claim a previous conversation and safely renders the rep photo', () => {
    const result = appointmentCopy({ ...input, touch: 'booking_email', firstName: '<Ernest>', photoUrl: 'https://crm.savingkc.com/photo.png' })
    expect(result.body).not.toContain('Good talking')
    expect(result.html).toContain('&lt;Ernest&gt;')
    expect(result.html).toContain('<img')
    expect(appointmentCopy({ ...input, touch: 'booking_email', photoUrl: 'javascript:alert(1)' }).html).not.toContain('<img')
  })
  it('keeps the automatic arrival wording and removes the inaccurate 90 minute claim', () => {
    expect(appointmentCopy({ ...input, touch: 'arrival_sms' }).body).toBe('On my way, should be there by 5:00 PM CT. See you shortly, Ernest.')
    expect(appointmentCopy({ ...input, touch: 'morning_sms', type: 'phone_call' }).body).toContain('talking with you')
    expect(appointmentCopy({ ...input, touch: 'morning_sms' }).body).not.toContain('90 minutes')
  })
})
