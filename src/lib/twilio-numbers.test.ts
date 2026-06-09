import { describe, expect, it } from 'vitest'
import {
  BROADCAST_TWILIO_NUMBERS,
  CONVERSATION_TWILIO_NUMBERS,
  DISPOSITIONS_TWILIO_NUMBER,
  DIALER_CALLER_ID_NUMBERS,
  GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER,
  GOOGLE_ADS_TWILIO_NUMBER,
  findTwilioNumber,
  isReservedTwilioNumber,
} from './twilio-numbers'

describe('twilio number inventory', () => {
  it('reserves Google Ads tracking numbers out of team sending and dialer pools', () => {
    for (const number of [GOOGLE_ADS_TWILIO_NUMBER, GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER]) {
      expect(isReservedTwilioNumber(number)).toBe(true)
      expect(CONVERSATION_TWILIO_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(BROADCAST_TWILIO_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(DIALER_CALLER_ID_NUMBERS.some((option) => option.value === number)).toBe(false)
    }
  })

  it('labels the 8858 number as dispositions eligible for Ernest call flow', () => {
    const number = findTwilioNumber(DISPOSITIONS_TWILIO_NUMBER)

    expect(number?.label).toContain('Dispositions')
    expect(number?.conversationEligible).toBe(true)
    expect(number?.dialerEligible).toBe(true)
  })
})
