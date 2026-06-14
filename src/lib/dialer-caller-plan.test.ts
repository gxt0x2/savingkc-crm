import { describe, expect, it } from 'vitest'
import { GOOGLE_ADS_TWILIO_NUMBER } from './twilio-numbers'
import { normalizeDialerCallerPlan } from './dialer-caller-plan'

describe('dialer-caller-plan', () => {
  it('filters the Google Ads-only number out of dialer rotations', () => {
    const plan = normalizeDialerCallerPlan({
      mode: 'rotation',
      staticCallerId: GOOGLE_ADS_TWILIO_NUMBER,
      rotationCallerIds: ['+18163077835', GOOGLE_ADS_TWILIO_NUMBER, '+18164292900'],
      redialCallerId: GOOGLE_ADS_TWILIO_NUMBER,
    })

    expect(plan.staticCallerId).toBe('+18163077835')
    expect(plan.rotationCallerIds).toEqual(['+18163077835', '+18164292900'])
    expect(plan.redialCallerId).toBeNull()
  })
})
