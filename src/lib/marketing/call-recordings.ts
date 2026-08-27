export const RECORDING_REVIEW_OUTCOMES = ['seller', 'spam', 'wrong_number', 'follow_up', 'review_later'] as const
export const CALL_REVIEW_SUBMISSION_NOTE_MAX_LENGTH = 500

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

export type CallReviewRevision = {
  reopenedAt: string
  reopenedBy: string
  framework: 'junior_acquisitions' | 'niche' | null
  completedAt: string | null
  completedBy: string | null
  score: number | null
  criticalScore: number | null
  needsCoaching: boolean
  coachingReasons: string[]
  scoringVersion: string | null
  answers: Record<string, number>
  tags: string[]
  reviewNote: string | null
  voiceoverPath: string | null
  voiceoverMimeType: string | null
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
  criticalScore: number | null
  needsCoaching: boolean
  coachingReasons: string[]
  scoringVersion: string | null
  aiStatus: 'idle' | 'processing' | 'ready' | 'failed'
  aiProcessedAt: string | null
  aiModel: string | null
  aiError: string | null
  aiScore: number | null
  aiCriticalScore: number | null
  aiAnswers: Record<
    string,
    {
      score: number
      confidence: 'low' | 'medium' | 'high'
      evidence: string
      timestamp: string | null
      reasoning: string
    }
  >
  aiCorrections: string[]
  answers: Record<string, number>
  tags: string[]
  reviewNote: string | null
  voiceoverPath: string | null
  voiceoverMimeType: string | null
  revisionHistory: CallReviewRevision[]
  lastReopenedAt: string | null
  lastReopenedBy: string | null
}

export function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
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
  return Math.max(0, Math.round(numberValue(meta.duration) ?? numberValue(meta.recordingDuration) ?? numberValue(meta.RecordingDuration) ?? 0))
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
  const rawAiAnswers = record(workflow.ai_answers)
  const revisionHistory = Array.isArray(workflow.revision_history)
    ? workflow.revision_history.flatMap((value): CallReviewRevision[] => {
        const revision = record(value)
        const framework = text(revision.framework)
        const rawRevisionAnswers = record(revision.answers)
        return [{
          reopenedAt: text(revision.reopened_at),
          reopenedBy: text(revision.reopened_by),
          framework: framework === 'junior_acquisitions' || framework === 'niche' ? framework : null,
          completedAt: text(revision.completed_at) || null,
          completedBy: text(revision.completed_by) || null,
          score: numberValue(revision.score),
          criticalScore: numberValue(revision.critical_score),
          needsCoaching: revision.needs_coaching === true,
          coachingReasons: Array.isArray(revision.coaching_reasons) ? revision.coaching_reasons.filter((reason): reason is string => typeof reason === 'string' && Boolean(reason.trim())) : [],
          scoringVersion: text(revision.scoring_version) || null,
          answers: Object.fromEntries(
            Object.entries(rawRevisionAnswers).flatMap(([key, answer]) => {
              const parsed = numberValue(answer)
              return parsed === null ? [] : [[key, Math.min(3, Math.max(0, Math.round(parsed)))]]
            }),
          ),
          tags: Array.isArray(revision.tags) ? revision.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())) : [],
          reviewNote: text(revision.review_note) || null,
          voiceoverPath: text(revision.voiceover_path) || null,
          voiceoverMimeType: text(revision.voiceover_mime_type) || null,
        }]
      })
    : []
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
    criticalScore: numberValue(workflow.critical_score),
    needsCoaching: workflow.needs_coaching === true,
    coachingReasons: Array.isArray(workflow.coaching_reasons) ? workflow.coaching_reasons.filter((reason): reason is string => typeof reason === 'string' && Boolean(reason.trim())) : [],
    scoringVersion: text(workflow.scoring_version) || null,
    aiStatus: ['processing', 'ready', 'failed'].includes(text(workflow.ai_status)) ? (text(workflow.ai_status) as 'processing' | 'ready' | 'failed') : 'idle',
    aiProcessedAt: text(workflow.ai_processed_at) || null,
    aiModel: text(workflow.ai_model) || null,
    aiError: text(workflow.ai_error) || null,
    aiScore: numberValue(workflow.ai_score),
    aiCriticalScore: numberValue(workflow.ai_critical_score),
    aiAnswers: Object.fromEntries(
      Object.entries(rawAiAnswers).flatMap(([id, value]) => {
        const assessment = record(value)
        const score = numberValue(assessment.score)
        if (score === null) return []
        const confidence = text(assessment.confidence)
        return [
          [
            id,
            {
              score: Math.min(3, Math.max(0, Math.round(score))),
              confidence: confidence === 'high' || confidence === 'medium' ? confidence : 'low',
              evidence: text(assessment.evidence),
              timestamp: text(assessment.timestamp) || null,
              reasoning: text(assessment.reasoning),
            },
          ],
        ]
      }),
    ),
    aiCorrections: Array.isArray(workflow.ai_corrections) ? workflow.ai_corrections.filter((id): id is string => typeof id === 'string' && Boolean(id.trim())) : [],
    answers: Object.fromEntries(
      Object.entries(rawAnswers).flatMap(([key, value]) => {
        if (typeof value === 'boolean') return [[key, value ? 3 : 0]]
        const parsed = numberValue(value)
        return parsed === null ? [] : [[key, Math.min(3, Math.max(0, Math.round(parsed)))]]
      }),
    ) as Record<string, number>,
    tags: Array.isArray(workflow.tags) ? workflow.tags.filter((tag): tag is string => typeof tag === 'string' && Boolean(tag.trim())) : [],
    reviewNote: text(workflow.review_note) || null,
    voiceoverPath: text(workflow.voiceover_path) || null,
    voiceoverMimeType: text(workflow.voiceover_mime_type) || null,
    revisionHistory,
    lastReopenedAt: text(workflow.last_reopened_at) || null,
    lastReopenedBy: text(workflow.last_reopened_by) || null,
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
    critical_score: workflow.criticalScore,
    needs_coaching: workflow.needsCoaching,
    coaching_reasons: workflow.coachingReasons,
    scoring_version: workflow.scoringVersion,
    ai_status: workflow.aiStatus,
    ai_processed_at: workflow.aiProcessedAt,
    ai_model: workflow.aiModel,
    ai_error: workflow.aiError,
    ai_score: workflow.aiScore,
    ai_critical_score: workflow.aiCriticalScore,
    ai_answers: workflow.aiAnswers,
    ai_corrections: workflow.aiCorrections,
    answers: workflow.answers,
    tags: workflow.tags,
    review_note: workflow.reviewNote,
    voiceover_path: workflow.voiceoverPath,
    voiceover_mime_type: workflow.voiceoverMimeType,
    revision_history: workflow.revisionHistory?.map((revision) => ({
      reopened_at: revision.reopenedAt,
      reopened_by: revision.reopenedBy,
      framework: revision.framework,
      completed_at: revision.completedAt,
      completed_by: revision.completedBy,
      score: revision.score,
      critical_score: revision.criticalScore,
      needs_coaching: revision.needsCoaching,
      coaching_reasons: revision.coachingReasons,
      scoring_version: revision.scoringVersion,
      answers: revision.answers,
      tags: revision.tags,
      review_note: revision.reviewNote,
      voiceover_path: revision.voiceoverPath,
      voiceover_mime_type: revision.voiceoverMimeType,
    })),
    last_reopened_at: workflow.lastReopenedAt,
    last_reopened_by: workflow.lastReopenedBy,
  }
  return {
    ...meta,
    call_review: {
      ...current,
      ...Object.fromEntries(Object.entries(keys).filter(([, value]) => value !== undefined)),
    },
  }
}

export function reopenCallReviewWorkflow(
  metadata: unknown,
  { reopenedAt, reopenedBy }: { reopenedAt: string; reopenedBy: string },
): { metadata: Record<string, unknown>; workflow: CallReviewWorkflow } {
  const existing = readCallReviewWorkflow(metadata)
  if (existing.status !== 'completed') {
    return { metadata: { ...record(metadata) }, workflow: existing }
  }

  const revision: CallReviewRevision = {
    reopenedAt,
    reopenedBy,
    framework: existing.framework,
    completedAt: existing.completedAt,
    completedBy: existing.completedBy,
    score: existing.score,
    criticalScore: existing.criticalScore,
    needsCoaching: existing.needsCoaching,
    coachingReasons: existing.coachingReasons,
    scoringVersion: existing.scoringVersion,
    answers: existing.answers,
    tags: existing.tags,
    reviewNote: existing.reviewNote,
    voiceoverPath: existing.voiceoverPath,
    voiceoverMimeType: existing.voiceoverMimeType,
  }
  const updatedMetadata = mergeCallReviewWorkflow(metadata, {
    status: 'submitted',
    submittedAt: reopenedAt,
    submittedBy: reopenedBy,
    assignedReviewer: existing.assignedReviewer || reopenedBy,
    completedAt: null,
    completedBy: null,
    score: null,
    criticalScore: null,
    needsCoaching: false,
    coachingReasons: [],
    scoringVersion: null,
    answers: existing.answers,
    reviewNote: existing.reviewNote,
    voiceoverPath: null,
    voiceoverMimeType: null,
    revisionHistory: [...existing.revisionHistory, revision],
    lastReopenedAt: reopenedAt,
    lastReopenedBy: reopenedBy,
  })
  return { metadata: updatedMetadata, workflow: readCallReviewWorkflow(updatedMetadata) }
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
  return text(meta.traffic_source).toLowerCase() === 'google_ads' || text(meta.campaign).toLowerCase().includes('search') || text(meta.lead_source).toLowerCase().includes('google_ads') || ['8166088808', '8166086648'].includes(text(meta.tracking_number).replace(/\D/g, ''))
}

export function compactTranscript(value: unknown, fallback = ''): string {
  const raw = text(value) || fallback
  return raw.replace(/\s+/g, ' ').trim()
}

export function buildRecordingSummary(
  items: Array<{
    durationSeconds: number
    outcome: StoredRecordingReviewOutcome
    isGoogleAds: boolean
  }>,
): RecordingSummary {
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
