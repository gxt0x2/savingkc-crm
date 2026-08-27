export const PREVIEW_CALL_REVIEW_QUEUE_KEY = 'savingkc:preview-call-review-queue:v1'
const PREVIEW_CALL_REVIEW_RESULT_PREFIX = 'savingkc:preview-call-review-result:v1:'

export type PreviewCallReviewSubmission = {
  activityId: string | null
  recordingSid: string | null
  recordingUrl: string
  durationSeconds: number
  submittedAt: string
  submissionNote: string | null
}

export function readPreviewCallReviewQueue(storage: Pick<Storage, 'getItem'>): PreviewCallReviewSubmission[] {
  try {
    const parsed = JSON.parse(storage.getItem(PREVIEW_CALL_REVIEW_QUEUE_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is PreviewCallReviewSubmission => {
      if (!item || typeof item !== 'object') return false
      const entry = item as Partial<PreviewCallReviewSubmission>
      return Boolean((entry.activityId || entry.recordingSid) && entry.recordingUrl && entry.submittedAt)
    })
  } catch {
    return []
  }
}

export function savePreviewCallReviewSubmission(
  storage: Pick<Storage, 'getItem' | 'setItem'>,
  submission: PreviewCallReviewSubmission,
) {
  const current = readPreviewCallReviewQueue(storage)
  const withoutDuplicate = current.filter((item) =>
    submission.activityId ? item.activityId !== submission.activityId : item.recordingSid !== submission.recordingSid,
  )
  storage.setItem(PREVIEW_CALL_REVIEW_QUEUE_KEY, JSON.stringify([submission, ...withoutDuplicate].slice(0, 12)))
}

export function readPreviewCallReviewResult<T>(storage: Pick<Storage, 'getItem'>, id: string): T | null {
  try {
    const saved = storage.getItem(`${PREVIEW_CALL_REVIEW_RESULT_PREFIX}${id}`)
    return saved ? JSON.parse(saved) as T : null
  } catch {
    return null
  }
}

export function savePreviewCallReviewResult(storage: Pick<Storage, 'setItem'>, id: string, result: unknown) {
  storage.setItem(`${PREVIEW_CALL_REVIEW_RESULT_PREFIX}${id}`, JSON.stringify(result))
}
