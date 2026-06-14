export const RECORDING_REVIEW_OUTCOMES = ['seller', 'spam', 'wrong_number', 'follow_up', 'review_later'] as const

export type RecordingReviewOutcome = (typeof RECORDING_REVIEW_OUTCOMES)[number]
export type StoredRecordingReviewOutcome = RecordingReviewOutcome | 'unreviewed'

export type RecordingReviewSnapshot = {
  outcome: StoredRecordingReviewOutcome
  note: string | null
  reviewedAt: string | null
  reviewedBy: string | null
}

export type RecordingSummary = {
  total: number
  needsReview: number
  seller: number
  spam: number
  followUp: number
  googleAds: number
  overFiveMinutes: number
  averageDurationSeconds: number
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

export function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

export function readRecordingDuration(metadata: unknown): number {
  const meta = record(metadata)
  return Math.max(0, Math.round(
    numberValue(meta.duration)
      ?? numberValue(meta.recordingDuration)
      ?? numberValue(meta.RecordingDuration)
      ?? 0,
  ))
}

export function readRecordingSid(metadata: unknown): string {
  const meta = record(metadata)
  return text(meta.recordingSid) || text(meta.RecordingSid)
}

export function playableRecordingUrl(metadata: unknown): string | null {
  const meta = record(metadata)
  const sid = readRecordingSid(meta)
  if (sid) return `/api/recordings/${encodeURIComponent(sid)}`

  const storedUrl = text(meta.recordingUrl) || text(meta.recording_url)
  if (storedUrl.startsWith('/api/recordings/')) return storedUrl
  return null
}

export function isRecordingReviewOutcome(value: unknown): value is RecordingReviewOutcome {
  return typeof value === 'string' && RECORDING_REVIEW_OUTCOMES.includes(value as RecordingReviewOutcome)
}

export function readRecordingReview(metadata: unknown): RecordingReviewSnapshot {
  const meta = record(metadata)
  const review = record(meta.recording_review)
  const rawOutcome = text(review.outcome) || text(meta.review_outcome) || text(meta.call_review_outcome)
  const outcome = isRecordingReviewOutcome(rawOutcome) ? rawOutcome : 'unreviewed'

  return {
    outcome,
    note: text(review.note) || text(meta.review_note) || null,
    reviewedAt: text(review.reviewed_at) || text(meta.reviewed_at) || null,
    reviewedBy: text(review.reviewed_by) || text(meta.reviewed_by) || null,
  }
}

export function mergeRecordingReviewMetadata(
  metadata: unknown,
  review: {
    outcome: RecordingReviewOutcome
    note?: string | null
    reviewedAt: string
    reviewedBy: string
  },
): Record<string, unknown> {
  const meta = { ...record(metadata) }
  return {
    ...meta,
    review_outcome: review.outcome,
    recording_review: {
      ...record(meta.recording_review),
      outcome: review.outcome,
      note: review.note?.trim() || null,
      reviewed_at: review.reviewedAt,
      reviewed_by: review.reviewedBy,
    },
  }
}

export function isGoogleAdsCall(metadata: unknown): boolean {
  const meta = record(metadata)
  return (
    text(meta.traffic_source).toLowerCase() === 'google_ads'
    || text(meta.campaign).toLowerCase().includes('search')
    || text(meta.lead_source).toLowerCase().includes('google_ads')
    || ['8166088808', '8166086648'].includes(text(meta.tracking_number).replace(/\D/g, ''))
  )
}

export function compactTranscript(value: unknown, fallback = ''): string {
  const raw = text(value) || fallback
  return raw.replace(/\s+/g, ' ').trim()
}

export function buildRecordingSummary(items: Array<{ durationSeconds: number; outcome: StoredRecordingReviewOutcome; isGoogleAds: boolean }>): RecordingSummary {
  const totalDuration = items.reduce((sum, item) => sum + item.durationSeconds, 0)
  return {
    total: items.length,
    needsReview: items.filter((item) => item.outcome === 'unreviewed' || item.outcome === 'review_later').length,
    seller: items.filter((item) => item.outcome === 'seller').length,
    spam: items.filter((item) => item.outcome === 'spam' || item.outcome === 'wrong_number').length,
    followUp: items.filter((item) => item.outcome === 'follow_up').length,
    googleAds: items.filter((item) => item.isGoogleAds).length,
    overFiveMinutes: items.filter((item) => item.durationSeconds >= 300).length,
    averageDurationSeconds: items.length ? Math.round(totalDuration / items.length) : 0,
  }
}
