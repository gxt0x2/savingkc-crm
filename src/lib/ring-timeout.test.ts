import { describe, it, expect } from 'vitest'
import {
  parseDialTimeout,
  DEFAULT_DIAL_TIMEOUT,
  dialTimeoutFallbackForSource,
  MOBILE_DIAL_TIMEOUT,
  WEB_CLICK_TO_CALL_DIAL_TIMEOUT,
} from './ring-timeout'

describe('parseDialTimeout', () => {
  it('converts rings to ~6s each', () => {
    expect(parseDialTimeout(2)).toBe(12)
    expect(parseDialTimeout(6)).toBe(36)
    expect(parseDialTimeout('4')).toBe(24)
  })

  it('clamps to a sane 10–60s window', () => {
    expect(parseDialTimeout(1)).toBe(10)   // 6s -> floor 10
    expect(parseDialTimeout(20)).toBe(60)  // 120s -> cap 60
  })

  it('falls back to the historical default when missing or invalid', () => {
    expect(parseDialTimeout(null)).toBe(DEFAULT_DIAL_TIMEOUT)
    expect(parseDialTimeout(undefined)).toBe(DEFAULT_DIAL_TIMEOUT)
    expect(parseDialTimeout('')).toBe(DEFAULT_DIAL_TIMEOUT)
    expect(parseDialTimeout('abc')).toBe(DEFAULT_DIAL_TIMEOUT)
    expect(parseDialTimeout(0)).toBe(DEFAULT_DIAL_TIMEOUT)
    expect(parseDialTimeout(-3)).toBe(DEFAULT_DIAL_TIMEOUT)
  })

  it('honors a custom fallback', () => {
    expect(parseDialTimeout(null, 20)).toBe(20)
  })
})

describe('dialTimeoutFallbackForSource', () => {
  it('gives every mobile source 45 seconds and keeps web click-to-call at 60', () => {
    expect(dialTimeoutFallbackForSource('mobile_manual')).toBe(MOBILE_DIAL_TIMEOUT)
    expect(dialTimeoutFallbackForSource('mobile_lead')).toBe(45)
    expect(dialTimeoutFallbackForSource('mobile_callback')).toBe(45)
    expect(dialTimeoutFallbackForSource('web_click_to_call')).toBe(WEB_CLICK_TO_CALL_DIAL_TIMEOUT)
  })

  it('leaves non-mobile outbound sources on the historical default', () => {
    expect(dialTimeoutFallbackForSource('web_manual')).toBeUndefined()
    expect(dialTimeoutFallbackForSource('web_heir_dialer')).toBeUndefined()
    expect(dialTimeoutFallbackForSource('legacy_sdk')).toBeUndefined()
    expect(dialTimeoutFallbackForSource(null)).toBeUndefined()
    expect(parseDialTimeout(null, dialTimeoutFallbackForSource('web_manual'))).toBe(DEFAULT_DIAL_TIMEOUT)
  })
})
