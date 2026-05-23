export type GoogleAdsQualityScore = 1 | 2 | 3

export type ConversionDeadlineStatus = 'normal' | 'review' | 'urgent' | 'critical' | 'expired'

export const GOOGLE_ADS_QUALITY_SCALE: Array<{
  score: GoogleAdsQualityScore
  title: string
  internalStandard: string
  googleSignal: string
}> = [
  {
    score: 1,
    title: 'Does not meet standard',
    internalStandard: 'Internal profit below $35k, or below the deal standard.',
    googleSignal: 'Google receives value 1.',
  },
  {
    score: 2,
    title: 'Meets standard',
    internalStandard: 'Internal profit between $40k and $60k.',
    googleSignal: 'Google receives value 2.',
  },
  {
    score: 3,
    title: 'Exceeds standard',
    internalStandard: 'Internal profit above $60k.',
    googleSignal: 'Google receives value 3.',
  },
]

const MS_PER_DAY = 86_400_000
const OFFLINE_CONVERSION_WINDOW_DAYS = 90

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

export function normalizeGoogleAdsQualityScore(value: unknown): GoogleAdsQualityScore | null {
  const parsed = typeof value === 'string' && value.trim() ? Number(value) : value
  if (parsed === 1 || parsed === 2 || parsed === 3) return parsed
  return null
}

export function resolveGoogleAdsQualityScore(
  conversionValue: unknown,
  payload: Record<string, unknown> | null | undefined,
): GoogleAdsQualityScore | null {
  const payloadScore = isRecord(payload)
    ? normalizeGoogleAdsQualityScore(
      payload.google_ads_quality_score ??
      payload.googleAdsQualityScore ??
      payload.quality_score ??
      payload.qualityScore,
    )
    : null

  return payloadScore ?? normalizeGoogleAdsQualityScore(conversionValue)
}

export function defaultGoogleAdsQualityScore(eventName: string | null | undefined): GoogleAdsQualityScore {
  if (
    eventName === 'lead_submitted' ||
    eventName === 'qualified_lead' ||
    eventName === 'appointment_booked' ||
    eventName === 'call_connected_5m'
  ) {
    return 2
  }
  return 1
}

export function googleAdsQualityPayload(input: {
  score: GoogleAdsQualityScore
  approvedAt: string
  approvedBy: string
}): Record<string, unknown> {
  return {
    google_ads_quality_score: input.score,
    google_ads_value_basis: 'quality_score_1_3',
    google_ads_value_version: '2026-05-23',
    google_ads_approved_at: input.approvedAt,
    google_ads_approved_by: input.approvedBy,
  }
}

export function conversionDeadline(
  eventTime: string | null | undefined,
  now: Date = new Date(),
): {
  eventAt: string | null
  expiresAt: string | null
  ageDays: number | null
  daysLeft: number | null
  status: ConversionDeadlineStatus
} {
  const eventDate = eventTime ? new Date(eventTime) : null
  if (!eventDate || Number.isNaN(eventDate.getTime())) {
    return { eventAt: null, expiresAt: null, ageDays: null, daysLeft: null, status: 'normal' }
  }

  const expiresAt = new Date(eventDate.getTime() + OFFLINE_CONVERSION_WINDOW_DAYS * MS_PER_DAY)
  const ageDays = Math.max(0, Math.floor((now.getTime() - eventDate.getTime()) / MS_PER_DAY))
  const daysLeft = Math.max(0, Math.ceil((expiresAt.getTime() - now.getTime()) / MS_PER_DAY))

  const status: ConversionDeadlineStatus = ageDays >= 90
    ? 'expired'
    : ageDays >= 86
      ? 'critical'
      : ageDays >= 76
        ? 'urgent'
        : ageDays >= 61
          ? 'review'
          : 'normal'

  return {
    eventAt: eventDate.toISOString(),
    expiresAt: expiresAt.toISOString(),
    ageDays,
    daysLeft,
    status,
  }
}
