import {
  DEFAULT_PPC_CAMPAIGN,
  PPC_CAMPAIGNS,
  ppcCampaignForPhone,
  type PpcCampaignConfig,
} from '@/lib/ppc/campaigns'

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

const PROPERTY_TAX_PPC_CAMPAIGN = PPC_CAMPAIGNS.find((campaign) => campaign.key === 'property_tax')!

export const PPC_TRACKING_PHONE_DIGITS = DEFAULT_PPC_CAMPAIGN.phoneDigits
export const PPC_TAX_TRACKING_PHONE_DIGITS = PROPERTY_TAX_PPC_CAMPAIGN.phoneDigits
export const PPC_TRACKING_PHONE_NUMBERS = PPC_CAMPAIGNS.map((campaign) => campaign.phoneTel)
export const GOOGLE_ADS_PHONE_NUMBER = DEFAULT_PPC_CAMPAIGN.phoneTel
export const GOOGLE_ADS_TAX_PHONE_NUMBER = PROPERTY_TAX_PPC_CAMPAIGN.phoneTel
export const GOOGLE_ADS_PHONE_SOURCE = DEFAULT_PPC_CAMPAIGN.phoneSource
export const GOOGLE_ADS_TAX_PHONE_SOURCE = PROPERTY_TAX_PPC_CAMPAIGN.phoneSource
export const GOOGLE_ADS_CAMPAIGN = DEFAULT_PPC_CAMPAIGN.name

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
    number: DEFAULT_PPC_CAMPAIGN.phoneTel,
    trackingDigits: DEFAULT_PPC_CAMPAIGN.phoneDigits,
    source: DEFAULT_PPC_CAMPAIGN.phoneSource,
    campaign: DEFAULT_PPC_CAMPAIGN.name,
    landingPage: DEFAULT_PPC_CAMPAIGN.pagePath,
  },
  {
    key: 'tax',
    label: 'Google Ads Tax',
    number: PROPERTY_TAX_PPC_CAMPAIGN.phoneTel,
    trackingDigits: PROPERTY_TAX_PPC_CAMPAIGN.phoneDigits,
    source: PROPERTY_TAX_PPC_CAMPAIGN.phoneSource,
    campaign: PROPERTY_TAX_PPC_CAMPAIGN.name,
    landingPage: PROPERTY_TAX_PPC_CAMPAIGN.pagePath,
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
  return Boolean(ppcCampaignForPhone(raw))
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

export function getPpcCampaignForPhone(raw: string | null | undefined): PpcCampaignConfig | null {
  return ppcCampaignForPhone(raw)
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

export function getGoogleAdsCallQualityMilestones(durationSeconds: number | null | undefined): CallQualityMilestone[] {
  const highest = getHighestCallQualityMilestone(durationSeconds)
  return highest ? [highest] : []
}
