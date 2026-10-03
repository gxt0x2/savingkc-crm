import { describe, expect, it } from 'vitest'
import { mobileInboundRoute } from './inbound-route'

describe('mobile inbound route classification', () => {
  it('classifies only cold callback DIDs and preserves company-line eligibility', () => {
    expect(mobileInboundRoute({ calledNumber: '+18166404701' })).toBe('cold_callback')
    expect(mobileInboundRoute({ calledNumber: '+18166088588' })).toBeNull()
  })

  it('supports exact legacy callback evidence when old activity rows lack the called DID', () => {
    expect(mobileInboundRoute({ source: 'cold_callback_press_1' })).toBe('cold_callback')
    expect(mobileInboundRoute({ tag: 'cold_callback_no_input' })).toBe('cold_callback')
    expect(mobileInboundRoute({}, 'Cold call callback from (816) 555-0123 — pressed 1')).toBe('cold_callback')
    expect(mobileInboundRoute({ source: 'inbound_ivr' }, 'Inbound seller call')).toBeNull()
  })
})
