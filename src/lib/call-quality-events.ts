export type CallQualityEventName =
  | 'call_connected_60s'
  | 'call_connected_2m'
  | 'call_connected_5m'

export type CallQualityMilestone = {
  event: CallQualityEventName
  seconds: number
  label: string
  conversionValue: number
}

export const PPC_TRACKING_PHONE_DIGITS = '8166088808'
export const PPC_TAX_TRACKING_PHONE_DIGITS = '8166086648'
export const GOOGLE_ADS_PHONE_NUMBER = '+18166088808'
export const GOOGLE_ADS_TAX_PHONE_NUMBER = '+18166086648'
export const GOOGLE_ADS_PHONE_SOURCE = 'google_ads_phone'
export const GOOGLE_ADS_TAX_PHONE_SOURCE = 'google_ads_tax_phone'
export const GOOGLE_ADS_CAMPAIGN = 'Search 2026'

export type GoogleAdsPhoneProfileKey = 'general' | 'tax'

export type GoogleAdsPhoneProfile = {
  key: GoogleAdsPhoneProfileKey
  label: string
  number: string
  trackingDigits: string
  source: string
  campaign: string
  landingPage: string
}

export const GOOGLE_ADS_PHONE_PROFILES: GoogleAdsPhoneProfile[] = [
  {
    key: 'general',
    label: 'Google Ads',
    number: GOOGLE_ADS_PHONE_NUMBER,
    trackingDigits: PPC_TRACKING_PHONE_DIGITS,
    source: GOOGLE_ADS_PHONE_SOURCE,
    campaign: GOOGLE_ADS_CAMPAIGN,
    landingPage: '/ppc',
  },
  {
    key: 'tax',
    label: 'Google Ads Tax',
    number: GOOGLE_ADS_TAX_PHONE_NUMBER,
    trackingDigits: PPC_TAX_TRACKING_PHONE_DIGITS,
    source: GOOGLE_ADS_TAX_PHONE_SOURCE,
    campaign: GOOGLE_ADS_CAMPAIGN,
    landingPage: '/ppc-tax',
  },
]

const DEFAULT_GOOGLE_ADS_PHONE_PROFILE = GOOGLE_ADS_PHONE_PROFILES[0]!

export const CALL_QUALITY_MILESTONES: CallQualityMilestone[] = [
  {
    event: 'call_connected_60s',
    seconds: 60,
    label: 'Connected call 60+ seconds',
    conversionValue: 10,
  },
  {
    event: 'call_connected_2m',
    seconds: 120,
    label: 'Connected call 2+ minutes',
    conversionValue: 25,
  },
  {
    event: 'call_connected_5m',
    seconds: 300,
    label: 'Connected call 5+ minutes',
    conversionValue: 75,
  },
]

export function parseCallDurationSeconds(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.max(0, Math.round(value)) : null
  }

  if (typeof value !== 'string' || !value.trim()) return null

  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : null
}

export function isPpcTrackingNumber(raw: string): boolean {
  const digits = raw.replace(/\D/g, '')
  return GOOGLE_ADS_PHONE_PROFILES.some((profile) => (
    digits === profile.trackingDigits || digits === `1${profile.trackingDigits}`
  ))
}

export function isGoogleAdsPhoneNumber(raw: string): boolean {
  return isPpcTrackingNumber(raw)
}

export function getGoogleAdsPhoneProfile(raw: string | null | undefined): GoogleAdsPhoneProfile {
  const value = (raw || '').trim().toLowerCase()
  const digits = value.replace(/\D/g, '')
  return GOOGLE_ADS_PHONE_PROFILES.find((profile) => (
    value === profile.source ||
    value === profile.key ||
    digits === profile.trackingDigits ||
    digits === `1${profile.trackingDigits}`
  )) || DEFAULT_GOOGLE_ADS_PHONE_PROFILE
}

export function getCallQualityMilestones(durationSeconds: number | null | undefined): CallQualityMilestone[] {
  if (durationSeconds == null || !Number.isFinite(durationSeconds)) return []
  const seconds = Math.max(0, Math.round(durationSeconds))
  return CALL_QUALITY_MILESTONES.filter((milestone) => seconds >= milestone.seconds)
}

export function getHighestCallQualityMilestone(durationSeconds: number | null | undefined): CallQualityMilestone | null {
  const milestones = getCallQualityMilestones(durationSeconds)
  return milestones[milestones.length - 1] || null
}
