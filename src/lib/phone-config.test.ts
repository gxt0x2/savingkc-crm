import { afterEach, describe, expect, it } from 'vitest'
import { readConfiguredPhone, readPhoneEnv, trimPhoneConfig } from './phone-config'

describe('phone config trimming', () => {
  const originalErnestPhone = process.env.ERNEST_PHONE

  afterEach(() => {
    if (originalErnestPhone === undefined) delete process.env.ERNEST_PHONE
    else process.env.ERNEST_PHONE = originalErnestPhone
  })

  it('trims a trailing newline without changing the number', () => {
    expect(trimPhoneConfig('+18163077835\n')).toBe('+18163077835')
    expect(trimPhoneConfig('+18163077835\r\n')).toBe('+18163077835')
    expect(trimPhoneConfig(' +18163077835 ')).toBe('+18163077835')
  })

  it('trims a literal escaped newline from a double-encoded env value', () => {
    expect(trimPhoneConfig('+18163077835\\n')).toBe('+18163077835')
  })

  it('reads the configured number and does not substitute a different number', () => {
    process.env.ERNEST_PHONE = '+18163077835\n'
    expect(readPhoneEnv('ERNEST_PHONE', '+19999999999')).toBe('+18163077835')
    expect(readConfiguredPhone('+18163077835\n', '+19999999999')).toBe('+18163077835')
    expect(readConfiguredPhone('\n', '+18163077835\n')).toBe('+18163077835')
    expect(readPhoneEnv('ERNEST_PHONE', '+19999999999')).not.toBe('+19999999999')
  })
})
