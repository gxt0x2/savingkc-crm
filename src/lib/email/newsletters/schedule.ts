import {
  NEWSLETTER_FROM_MAILBOX,
  NEWSLETTER_OWNER_APPROVAL_VALUE,
  type NewsletterEditionKey,
} from './constants'

export type NewsletterSchedule = {
  edition: NewsletterEditionKey
  name: string
  program: 'seller_nurture' | 'buyer_marketing'
  fromMailbox: typeof NEWSLETTER_FROM_MAILBOX
  weekday: 'tuesday'
  localTime: '07:00'
  timezone: 'America/Chicago'
  state: 'disabled'
  mode: 'draft_only'
  ownerApproved: false
}

/**
 * Both editions are created disabled and draft-only.
 * There is no enroll path and no provider send in this module.
 */
export function newsletterSchedules(): NewsletterSchedule[] {
  return [
    {
      edition: 'tuesday_note',
      name: 'The Tuesday Note',
      program: 'seller_nurture',
      fromMailbox: NEWSLETTER_FROM_MAILBOX,
      weekday: 'tuesday',
      localTime: '07:00',
      timezone: 'America/Chicago',
      state: 'disabled',
      mode: 'draft_only',
      ownerApproved: false,
    },
    {
      edition: 'tuesday_deal_desk',
      name: 'The Tuesday Deal Desk',
      program: 'buyer_marketing',
      fromMailbox: NEWSLETTER_FROM_MAILBOX,
      weekday: 'tuesday',
      localTime: '07:00',
      timezone: 'America/Chicago',
      state: 'disabled',
      mode: 'draft_only',
      ownerApproved: false,
    },
  ]
}

export function ownerApprovalGranted(env: NodeJS.ProcessEnv = process.env) {
  return env.NEWSLETTER_OWNER_APPROVED === NEWSLETTER_OWNER_APPROVAL_VALUE
}

export type NewsletterHoldReason =
  | 'suppressed'
  | 'disabled'
  | 'owner_approval_required'
  | 'draft_only'
  | 'live_send_blocked'

export type NewsletterDispatchDecision = {
  action: 'hold'
  reason: NewsletterHoldReason
  sent: false
  enrolled: false
}

type DispatchInput = {
  state: string
  mode: string
  ownerApproved: boolean
  suppressed?: boolean
  ownerApprovalFlag?: string | undefined
}

/** Refuse every send. Approval is necessary later, and it is not sufficient now. */
export function holdNewsletterDispatch(input: DispatchInput): NewsletterDispatchDecision {
  const base = { action: 'hold' as const, sent: false as const, enrolled: false as const }
  if (input.suppressed) return { ...base, reason: 'suppressed' }
  if (input.state === 'disabled') return { ...base, reason: 'disabled' }
  const flagGranted = input.ownerApprovalFlag === NEWSLETTER_OWNER_APPROVAL_VALUE
  if (!flagGranted || input.ownerApproved !== true) {
    return { ...base, reason: 'owner_approval_required' }
  }
  if (input.mode === 'draft_only') return { ...base, reason: 'draft_only' }
  return { ...base, reason: 'live_send_blocked' }
}
