import { describe, expect, it } from 'vitest'
import {
  RESERVED_ADS_NUMBER_ID,
  blastAndDialerEligibility,
  canSaveResponseLine,
  canTestResponseLine,
  responseLineStateAfterSave,
} from '../phone-line'

describe('email response line', () => {
  it('saves an existing number as intended without purchase or blast eligibility', () => {
    expect(
      canSaveResponseLine({
        existingProviderNumberId: '00000000-0000-4000-8000-0000000000e1',
        purpose: 'email_response',
        purchase: false,
      }),
    ).toBe(true)
    expect(
      canSaveResponseLine({
        existingProviderNumberId: RESERVED_ADS_NUMBER_ID,
        purpose: 'email_response',
        purchase: false,
      }),
    ).toBe(false)
    expect(
      canSaveResponseLine({
        existingProviderNumberId: '00000000-0000-4000-8000-0000000000e1',
        purpose: 'email_response',
        purchase: true,
      }),
    ).toBe(false)
    expect(responseLineStateAfterSave()).toBe('intended')
    expect(blastAndDialerEligibility()).toEqual({ blast: false, dialer: false })
    expect(canTestResponseLine('intended')).toBe(false)
  })
})
