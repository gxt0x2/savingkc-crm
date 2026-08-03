import { describe, expect, it } from 'vitest'
import {
  BROADCAST_TWILIO_NUMBERS,
  CONVERSATION_TWILIO_NUMBERS,
  DISPOSITIONS_TWILIO_NUMBER,
  DIALER_CALLER_ID_NUMBERS,
  GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER,
  GOOGLE_ADS_TWILIO_NUMBER,
  findTwilioNumber,
  isAllowedSmsSender,
  isReservedTwilioNumber,
  TWILIO_NUMBERS,
} from './twilio-numbers'

describe('twilio number inventory', () => {
  it('contains the full 21-number owned inventory without duplicates', () => {
    expect(TWILIO_NUMBERS).toHaveLength(21)
    expect(new Set(TWILIO_NUMBERS.map((number) => number.value)).size).toBe(21)
  })

  it('reserves Google Ads tracking numbers out of team sending and dialer pools', () => {
    for (const number of [GOOGLE_ADS_TWILIO_NUMBER, GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER]) {
      expect(isReservedTwilioNumber(number)).toBe(true)
      expect(CONVERSATION_TWILIO_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(BROADCAST_TWILIO_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(DIALER_CALLER_ID_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(isAllowedSmsSender(number, 'conversation')).toBe(false)
      expect(isAllowedSmsSender(number, 'broadcast')).toBe(false)
      expect(isAllowedSmsSender(number, 'reply')).toBe(true)
      expect(isAllowedSmsSender(number, 'system')).toBe(false)
    }
  })

  it('normalizes approved conversation senders and rejects unknown numbers', () => {
    expect(isAllowedSmsSender('(816) 307-7835', 'conversation')).toBe(true)
    expect(isAllowedSmsSender('+18167277667', 'conversation')).toBe(true)
    expect(isAllowedSmsSender('+18165550199', 'conversation')).toBe(false)
  })

  it('labels the 8858 number as dispositions eligible for Ernest call flow', () => {
    const number = findTwilioNumber(DISPOSITIONS_TWILIO_NUMBER)

    expect(number?.label).toContain('Dispositions')
    expect(number?.conversationEligible).toBe(true)
    expect(number?.dialerEligible).toBe(true)
  })
})
