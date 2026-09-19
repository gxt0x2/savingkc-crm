/**
 * Staging-first mobile Voice flags.
 *
 * MOBILE_IN_APP_VOICE=true rings Casey/Ernest company numbers into the
 * registered Twilio Client identity (CallKit / in-app) instead of the
 * personal-forward cell path.
 *
 * MOBILE_PERSONAL_FORWARD defaults OFF whenever the in-app path is on.
 * Set MOBILE_PERSONAL_FORWARD=true only as an emergency rollback.
 *
 * Env names only — never log or return values.
 */
export const ERNEST_COMPANY_DIRECT_NUMBERS = [
  '+18166088588',
  '+18166088858',
] as const

export const CASEY_COMPANY_DIRECT_NUMBERS = [
  '+18167277667',
  '+18163754666',
] as const

export type MobileDirectAgent = 'ernest' | 'casey'

function flag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === 'true'
}

export function isMobileInAppVoiceEnabled(): boolean {
  return flag('MOBILE_IN_APP_VOICE')
}

export function isMobilePersonalForwardEnabled(): boolean {
  if (!isMobileInAppVoiceEnabled()) return true
  return flag('MOBILE_PERSONAL_FORWARD')
}

export function shouldRingMobileClient(calledNumber: string | null | undefined): boolean {
  return isMobileInAppVoiceEnabled() && !isMobilePersonalForwardEnabled() && Boolean(mobileClientIdentityForNumber(calledNumber))
}

export function mobileClientIdentityForNumber(calledNumber: string | null | undefined): MobileDirectAgent | null {
  const to = calledNumber?.trim() || ''
  if ((ERNEST_COMPANY_DIRECT_NUMBERS as readonly string[]).includes(to)) return 'ernest'
  if ((CASEY_COMPANY_DIRECT_NUMBERS as readonly string[]).includes(to)) return 'casey'
  return null
}

export function mobileVoiceCapabilities() {
  const inApp = isMobileInAppVoiceEnabled()
  const personalForward = isMobilePersonalForwardEnabled()
  return {
    twilioNativeVoice: true,
    mobileInAppVoice: inApp,
    personalForward,
    inboundClientRing: inApp && !personalForward,
  }
}
