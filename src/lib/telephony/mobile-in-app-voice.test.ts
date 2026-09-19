import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isMobileInAppVoiceEnabled,
  isMobilePersonalForwardEnabled,
  mobileClientIdentityForNumber,
  mobileVoiceCapabilities,
  shouldRingMobileClient,
} from './mobile-in-app-voice'

describe('mobile in-app voice flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('keeps personal-forward on until the in-app path is explicitly enabled', () => {
    expect(isMobileInAppVoiceEnabled()).toBe(false)
    expect(isMobilePersonalForwardEnabled()).toBe(true)
    expect(shouldRingMobileClient('+18167277667')).toBe(false)
    expect(mobileVoiceCapabilities()).toMatchObject({
      mobileInAppVoice: false,
      personalForward: true,
      inboundClientRing: false,
    })
  })

  it('turns personal-forward OFF for app users when the in-app path is available', () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')

    expect(isMobileInAppVoiceEnabled()).toBe(true)
    expect(isMobilePersonalForwardEnabled()).toBe(false)
    expect(shouldRingMobileClient('+18166088588')).toBe(true)
    expect(shouldRingMobileClient('+18167277667')).toBe(true)
    expect(mobileClientIdentityForNumber('+18163754666')).toBe('casey')
    expect(mobileVoiceCapabilities()).toMatchObject({
      personalForward: false,
      inboundClientRing: true,
    })
  })

  it('allows an explicit personal-forward rollback without inventing a From number', () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')
    vi.stubEnv('MOBILE_PERSONAL_FORWARD', 'true')

    expect(isMobilePersonalForwardEnabled()).toBe(true)
    expect(shouldRingMobileClient('+18166088588')).toBe(false)
  })

  it('does not treat IVR or ads numbers as in-app Client rings', () => {
    vi.stubEnv('MOBILE_IN_APP_VOICE', 'true')
    expect(shouldRingMobileClient('+18163077835')).toBe(false)
    expect(shouldRingMobileClient('+18166088808')).toBe(false)
  })
})
