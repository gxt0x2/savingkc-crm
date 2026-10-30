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
  isColdCallCallbackNumber,
  isColdCallDialerNumber,
  isDialerCallerIdNumber,
  isReservedTwilioNumber,
  TWILIO_NUMBERS,
} from './twilio-numbers'

describe('twilio number inventory', () => {
  it('contains the owned inventory without duplicates', () => {
    expect(TWILIO_NUMBERS).toHaveLength(13)
    expect(new Set(TWILIO_NUMBERS.map((number) => number.value)).size).toBe(13)
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

  it('drops the released cold numbers and rotates prospecting through the four new DIDs', () => {
    const released = [
      '+18164761344', '+18166404701', '+18165788107', '+18166536616',
      '+18163100845', '+18162538313', '+18164761589', '+18166408032',
    ]
    const prospecting = ['+18166088770', '+18166088552', '+18166088559', '+18166086999']

    for (const number of released) {
      expect(findTwilioNumber(number)).toBeUndefined()
      expect(isDialerCallerIdNumber(number)).toBe(false)
      expect(isColdCallDialerNumber(number)).toBe(false)
      expect(isColdCallCallbackNumber(number)).toBe(false)
      expect(DIALER_CALLER_ID_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(COLD_CALL_DIALER_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(BROADCAST_TWILIO_NUMBERS.some((option) => option.value === number)).toBe(false)
      expect(isAllowedSmsSender(number, 'reply')).toBe(false)
      expect(isAllowedSmsSender(number, 'broadcast')).toBe(false)
      expect(isAllowedSmsSender(number, 'conversation')).toBe(false)
    }

    expect(COLD_CALL_DIALER_NUMBERS.map((number) => number.value)).toEqual(prospecting)
    for (const number of prospecting) {
      const config = findTwilioNumber(number)
      expect(config?.purpose).toBe('cold_call')
      expect(config?.label).toContain('Prospecting')
      expect(config?.dialerEligible).toBe(true)
      expect(config?.broadcastEligible).toBe(true)
      expect(isColdCallDialerNumber(number)).toBe(true)
      expect(isColdCallCallbackNumber(number)).toBe(true)
    }
    for (const number of ['+18163077835', '+18167277667', DISPOSITIONS_TWILIO_NUMBER, ...prospecting]) {
      expect(findTwilioNumber(number)?.dialerEligible).toBe(true)
      expect(isDialerCallerIdNumber(number)).toBe(true)
    }
  })

  it('labels Gertha and keeps her out of the prospecting caller-ID pool', () => {
    const gertha = findTwilioNumber('+18166086699')

    expect(gertha?.label).toContain('Gertha Dotson (Admin/TC)')
    expect(gertha?.purpose).toBe('general')
    expect(gertha?.dialerEligible).toBe(false)
    expect(gertha?.conversationEligible).toBe(true)
    expect(gertha?.broadcastEligible).toBe(true)
    expect(isColdCallDialerNumber('+18166086699')).toBe(false)
    expect(isColdCallCallbackNumber('+18166086699')).toBe(false)
    expect(isDialerCallerIdNumber('+18166086699')).toBe(false)
    expect(COLD_CALL_DIALER_NUMBERS.some((number) => number.value === '+18166086699')).toBe(false)
    expect(isAllowedSmsSender('+18166086699', 'conversation')).toBe(true)
    expect(isAllowedSmsSender('+18166086699', 'broadcast')).toBe(true)
  })

  it('labels the 8858 number as dispositions eligible for Ernest call flow', () => {
    const number = findTwilioNumber(DISPOSITIONS_TWILIO_NUMBER)

    expect(number?.label).toContain('Dispositions')
    expect(number?.conversationEligible).toBe(true)
    expect(number?.dialerEligible).toBe(true)
  })
})
