import type { DurableDialerAttempt, DurableDialerSession } from '@/lib/dialer-session-client'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

const UNFINISHED_ATTEMPT_STATUSES = new Set<DurableDialerAttempt['status']>([
  'authorized',
  'dialing',
  'connected',
  'awaiting_disposition',
])

export interface RecoverableDialerAttempt {
  attempt: DurableDialerAttempt
  queueIndex: number
  queueItem: HeirDialerQueueItem
  needsEndTransition: boolean
}

export function findRecoverableDialerAttempt(
  session: DurableDialerSession,
  attempts: DurableDialerAttempt[],
  queue: HeirDialerQueueItem[],
): RecoverableDialerAttempt | null {
  const attempt = attempts.find((candidate) => (
    UNFINISHED_ATTEMPT_STATUSES.has(candidate.status)
    && candidate.subject_kind === session.currentSubjectKind
    && candidate.subject_id === session.currentSubjectId
  ))
  if (!attempt) return null

  const attemptPhone = normalizePhoneToE164(attempt.phone)
  const queueIndex = queue.findIndex((item) => {
    if (attempt.prospect_phone_id && item.prospect_phone_id === attempt.prospect_phone_id) return true
    if (attempt.subject_kind === 'lead' && item.leadId !== attempt.subject_id) return false
    if (attempt.subject_kind === 'prospect' && item.prospectId !== attempt.subject_id) return false
    return Boolean(attemptPhone && normalizePhoneToE164(item.phone) === attemptPhone)
  })
  if (queueIndex < 0) return null

  return {
    attempt,
    queueIndex,
    queueItem: queue[queueIndex],
    needsEndTransition: attempt.status !== 'awaiting_disposition',
  }
}
