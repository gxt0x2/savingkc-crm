import { describe, expect, it } from 'vitest'
import {
  BROADCAST_TWILIO_NUMBERS,
  CONVERSATION_TWILIO_NUMBERS,
  COLD_CALL_DIALER_NUMBERS,
  DISPOSITIONS_TWILIO_NUMBER,
  DIALER_CALLER_ID_NUMBERS,
  GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER,
  GOOGLE_ADS_TWILIO_NUMBER,
  findTwilioNumber,
  isAllowedSmsSender,
  isColdCallDialerNumber,
  isDialerCallerIdNumber,
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

  it('parks spam-flagged cold numbers out of dialer rotation and broadcasts', () => {
    const parked = ['+18162538313', '+18166408032', '+18163100845', '+18164761589']
    const stillColdOutbound = ['+18166404701', '+18165788107', '+18166536616', '+18164761344']

    for (const number of parked) {
      const config = findTwilioNumber(number)
      expect(config?.purpose).toBe('cold_call')
      expect(config?.label).toContain('PARKED')
      expect(config?.smsEligible).toBe(true)
      expect(config?.conversationEligible).toBe(true)
      expect(config?.broadcastEligible).toBe(false)
      expect(config?.dialerEligible).toBe(false)
      expect(isDialerCallerIdNumber(number)).toBe(false)
      expect(isColdCallDialerNumber(number)).toBe(false)
      expect(DIALER_CALLER_ID_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(COLD_CALL_DIALER_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(BROADCAST_TWILIO_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(isAllowedSmsSender(number, 'reply')).toBe(true)
      expect(isAllowedSmsSender(number, 'broadcast')).toBe(false)
      expect(isAllowedSmsSender(number, 'conversation')).toBe(true)
    }

    expect(COLD_CALL_DIALER_NUMBERS.map((number) => number.value)).toEqual(stillColdOutbound)
    for (const number of ['+18163077835', '+18167277667', DISPOSITIONS_TWILIO_NUMBER, ...stillColdOutbound]) {
      expect(findTwilioNumber(number)?.dialerEligible).toBe(true)
      expect(isDialerCallerIdNumber(number)).toBe(true)
    }
  })

  it('labels the 8858 number as dispositions eligible for Ernest call flow', () => {
    const number = findTwilioNumber(DISPOSITIONS_TWILIO_NUMBER)

    expect(number?.label).toContain('Dispositions')
    expect(number?.conversationEligible).toBe(true)
    expect(number?.dialerEligible).toBe(true)
  })
})
