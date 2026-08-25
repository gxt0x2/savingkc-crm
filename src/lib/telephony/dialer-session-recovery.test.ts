import { describe, expect, it } from 'vitest'
import type { DurableDialerAttempt, DurableDialerSession } from '@/lib/dialer-session-client'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'
import { findRecoverableDialerAttempt } from './dialer-session-recovery'

const session = {
  currentSubjectKind: 'prospect',
  currentSubjectId: '00000000-0000-4000-8000-000000000021',
} as DurableDialerSession

const queue: HeirDialerQueueItem[] = [{
  leadId: null,
  prospectId: session.currentSubjectId,
  campaignMemberId: '00000000-0000-4000-8000-000000000023',
  prospect_phone_id: '00000000-0000-4000-8000-000000000022',
  phone: '(541) 554-3687',
  heirName: 'Judith Guinn',
  relation: 'unknown',
  propertyAddress: '825 SE 11th St',
  deceasedOwnerName: 'Guinn O Allen & Kathy K',
}]

function attempt(status: DurableDialerAttempt['status']): DurableDialerAttempt {
  return {
    id: '00000000-0000-4000-8000-000000000024',
    client_attempt_id: 'attempt-1',
    subject_kind: 'prospect',
    subject_id: session.currentSubjectId,
    campaign_member_id: queue[0].campaignMemberId,
    lead_id: null,
    prospect_id: session.currentSubjectId,
    prospect_phone_id: queue[0].prospect_phone_id,
    phone: '+15415543687',
    caller_id: '+18163077835',
    status,
    disposition: null,
    duration_seconds: 42,
    reached: null,
    started_at: '2026-08-25T20:00:00.000Z',
    connected_at: null,
    ended_at: status === 'awaiting_disposition' ? '2026-08-25T20:00:42.000Z' : null,
    dispositioned_at: null,
    created_at: '2026-08-25T20:00:00.000Z',
    updated_at: '2026-08-25T20:00:42.000Z',
    leadName: 'Guinn O Allen & Kathy K',
    propertyAddress: '825 SE 11th St',
    postCallReview: {
      status: 'not_requested',
      summary: null,
      sentiment: null,
      motivationScore: null,
      nextAction: null,
      nextActionAt: null,
      strengths: [],
      improvements: [],
      recordingSid: null,
      providerCallSid: null,
      completedAt: null,
      updatedAt: null,
      failureCode: null,
      changeProposal: null,
    },
  }
}

describe('dialer session recovery', () => {
  it('restores the exact associated number waiting for a required outcome', () => {
    expect(findRecoverableDialerAttempt(session, [attempt('awaiting_disposition')], queue)).toMatchObject({
      queueIndex: 0,
      queueItem: queue[0],
      needsEndTransition: false,
    })
  })

  it('requires an explicit finish step for a browser-interrupted active attempt', () => {
    expect(findRecoverableDialerAttempt(session, [attempt('connected')], queue)).toMatchObject({
      queueIndex: 0,
      needsEndTransition: true,
    })
  })

  it('ignores completed attempts and attempts for another seller', () => {
    expect(findRecoverableDialerAttempt(session, [attempt('dispositioned')], queue)).toBeNull()
    expect(findRecoverableDialerAttempt(session, [{ ...attempt('awaiting_disposition'), subject_id: 'other' }], queue)).toBeNull()
  })
})
