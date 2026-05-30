import { describe, expect, it } from 'vitest'
import {
  BROADCAST_TWILIO_NUMBERS,
  CONVERSATION_TWILIO_NUMBERS,
  DIALER_CALLER_ID_NUMBERS,
  GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER,
  GOOGLE_ADS_TWILIO_NUMBER,
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
})
