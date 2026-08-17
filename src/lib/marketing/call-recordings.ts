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

export type CallReviewWorkflow = {
  status: 'available' | 'submitted' | 'completed'
  framework: 'junior_acquisitions' | 'niche' | null
  submittedAt: string | null
  submittedBy: string | null
  assignedReviewer: string | null
  submissionNote: string | null
  completedAt: string | null
  completedBy: string | null
  score: number | null
  answers: Record<string, number>
  tags: string[]
  reviewNote: string | null
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

  const storedUrl = text(meta.recordingUrl) || text(meta.recording_url) || text(meta.RecordingUrl)
  if (storedUrl.startsWith('/api/recordings/')) return storedUrl

  // Historical Twilio callbacks stored the protected API URL instead of the
  // in-app proxy URL. Recover the recording SID and keep credentials server-side.
  try {
    const parsed = new URL(storedUrl)
    if (parsed.hostname === 'api.twilio.com') {
      const twilioMatch = parsed.pathname.match(/\/Recordings\/(RE[A-Za-z0-9]+)(?:\.[a-z0-9]+)?$/i)
      if (twilioMatch?.[1]) return `/api/recordings/${encodeURIComponent(twilioMatch[1])}`
    }
  } catch {
    // Non-URL values are intentionally rejected below.
  }

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

export function readCallReviewWorkflow(metadata: unknown): CallReviewWorkflow {
  const workflow = record(record(metadata).call_review)
  const rawStatus = text(workflow.status)
  const framework = text(workflow.framework)
  const rawAnswers = record(workflow.answers)
  return {
    status: rawStatus === 'submitted' || rawStatus === 'completed' ? rawStatus : 'available',
    framework: framework === 'junior_acquisitions' || framework === 'niche' ? framework : null,
    submittedAt: text(workflow.submitted_at) || null,
    submittedBy: text(workflow.submitted_by) || null,
    assignedReviewer: text(workflow.assigned_reviewer) || null,
    submissionNote: text(workflow.submission_note) || null,
    completedAt: text(workflow.completed_at) || null,
    completedBy: text(workflow.completed_by) || null,
    score: numberValue(workflow.score),
    answers: Object.fromEntries(Object.entries(rawAnswers).flatMap(([key, value]) => {
      if (typeof value === 'boolean') return [[key, value ? 3 : 0]]
      const parsed = numberValue(value)
      return parsed === null ? [] : [[key, Math.min(3, Math.max(0, Math.round(parsed)))]]
    })) as Record<string, number>,
    tags: Array.isArray(workflow.tags) ? workflow.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())) : [],
    reviewNote: text(workflow.review_note) || null,
  }
}

export function mergeCallReviewWorkflow(metadata: unknown, workflow: Partial<CallReviewWorkflow>): Record<string, unknown> {
  const meta = { ...record(metadata) }
  const current = record(meta.call_review)
  const keys: Record<string, unknown> = {
    status: workflow.status,
    framework: workflow.framework,
    submitted_at: workflow.submittedAt,
    submitted_by: workflow.submittedBy,
    assigned_reviewer: workflow.assignedReviewer,
    submission_note: workflow.submissionNote,
    completed_at: workflow.completedAt,
    completed_by: workflow.completedBy,
    score: workflow.score,
    answers: workflow.answers,
    tags: workflow.tags,
    review_note: workflow.reviewNote,
  }
  return { ...meta, call_review: { ...current, ...Object.fromEntries(Object.entries(keys).filter(([, value]) => value !== undefined)) } }
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
