import { dispositionStopsNumber, normalizeDisposition } from '@/lib/dialer-dispositions'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

export const DIALER_CALLING_TIME_ZONE = 'America/Chicago'
export const DIALER_CALLING_WINDOW_LABEL = 'Monday-Saturday, 9:00 AM-7:00 PM Central'

export type DialerCallBlockReason =
  | 'invalid_phone'
  | 'outside_calling_hours'
  | 'dead_lead'
  | 'do_not_call'
  | 'wrong_number'
  | 'disconnected'
  | 'blocked_number'
  | 'internal_destination'
  | 'destination_mismatch'
  | 'policy_unavailable'

export type DialerCallDecision =
  | {
      allowed: true
      normalizedPhone: string
    }
  | {
      allowed: false
      normalizedPhone: string | null
      reason: DialerCallBlockReason
      message: string
    }

export interface DialerLeadPolicyFact {
  station?: string | null
  classification?: string | null
  dead_reason?: string | null
  call_result?: string | null
}

export interface DialerProspectPhonePolicyFact {
  last_disposition?: string | null
  phone_connected?: boolean | string | null
}

export interface DialerActivityPolicyFact {
  disposition?: string | null
  outcome?: string | null
  phone_status?: string | null
}

export interface DialerCallPolicyInput {
  phone: string | number | null | undefined
  now?: Date
  leads: readonly DialerLeadPolicyFact[]
  suppressionReasons: readonly (string | null | undefined)[]
  prospectPhones: readonly DialerProspectPhonePolicyFact[]
  activities: readonly DialerActivityPolicyFact[]
  internalNumbers: readonly string[]
  callingHoursExempt?: boolean
}

const BLOCK_MESSAGES: Record<DialerCallBlockReason, string> = {
  invalid_phone: 'Enter a valid 10-digit US phone number.',
  outside_calling_hours: `Calling is paused outside ${DIALER_CALLING_WINDOW_LABEL}.`,
  dead_lead: 'This contact is marked dead and cannot be called.',
  do_not_call: 'This number is on the do-not-call list.',
  wrong_number: 'This number is marked as a wrong number.',
  disconnected: 'This number is marked disconnected.',
  blocked_number: 'This number is blocked from outbound calling.',
  internal_destination: 'Company and team phone numbers cannot be called from the prospecting dialer.',
  destination_mismatch: 'The selected contact does not match this phone number.',
  policy_unavailable: 'Calling is paused because the safety check is unavailable.',
}

export function dialerCallBlock(
  reason: DialerCallBlockReason,
  normalizedPhone: string | null = null,
): DialerCallDecision {
  return { allowed: false, normalizedPhone, reason, message: BLOCK_MESSAGES[reason] }
}

function centralClockParts(now: Date): { weekday: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: DIALER_CALLING_TIME_ZONE,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)

  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    weekday: value('weekday'),
    hour: Number(value('hour')),
    minute: Number(value('minute')),
  }
}

/** SavingKC's deliberately narrower outbound safety window. */
export function isWithinDialerCallingHours(now = new Date()): boolean {
  if (!Number.isFinite(now.getTime())) return false
  const { weekday, hour, minute } = centralClockParts(now)
  if (weekday === 'Sun') return false
  const minutesSinceMidnight = (hour * 60) + minute
  return minutesSinceMidnight >= (9 * 60) && minutesSinceMidnight < (19 * 60)
}

export function phoneLookupVariants(raw: string | number | null | undefined): string[] {
  const normalized = normalizePhoneToE164(raw)
  if (!normalized) return []
  const national = normalized.slice(2)
  const area = national.slice(0, 3)
  const exchange = national.slice(3, 6)
  const subscriber = national.slice(6)
  return Array.from(new Set([
    String(raw ?? '').trim(),
    normalized,
    normalized.slice(1),
    national,
    `${area}-${exchange}-${subscriber}`,
    `(${area}) ${exchange}-${subscriber}`,
    `${area} ${exchange} ${subscriber}`,
    `${area}.${exchange}.${subscriber}`,
  ].filter(Boolean)))
}

function stopReason(raw: string | null | undefined): DialerCallBlockReason | null {
  const disposition = normalizeDisposition(raw)
  if (!disposition || !dispositionStopsNumber(disposition)) return null
  if (disposition === 'dnc') return 'do_not_call'
  if (disposition === 'wrong_number') return 'wrong_number'
  return 'disconnected'
}

function suppressionReason(raw: string | null | undefined): DialerCallBlockReason | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value) return 'do_not_call'
  if (value.includes('wrong')) return 'wrong_number'
  if (value.includes('disconnect') || value.includes('bad_number') || value.includes('not_in_service')) return 'disconnected'
  if (value.includes('spam') || value.includes('block')) return 'blocked_number'
  return 'do_not_call'
}

export function evaluateDialerCallPolicy(input: DialerCallPolicyInput): DialerCallDecision {
  const normalizedPhone = normalizePhoneToE164(input.phone)
  if (!normalizedPhone) return dialerCallBlock('invalid_phone')

  if (input.internalNumbers.some((number) => normalizePhoneToE164(number) === normalizedPhone)) {
    return dialerCallBlock('internal_destination', normalizedPhone)
  }

  for (const reason of input.suppressionReasons) {
    const blocked = suppressionReason(reason)
    if (blocked) return dialerCallBlock(blocked, normalizedPhone)
  }

  for (const lead of input.leads) {
    if (['dead', 'closed_lost'].includes(lead.station?.toLowerCase() ?? '') || lead.classification?.toLowerCase() === 'dead') {
      return dialerCallBlock('dead_lead', normalizedPhone)
    }
    const blocked = stopReason(lead.call_result)
    if (blocked) return dialerCallBlock(blocked, normalizedPhone)
  }

  for (const prospectPhone of input.prospectPhones) {
    const connection = String(prospectPhone.phone_connected ?? '').trim().toLowerCase()
    if (connection === 'false' || connection === 'disconnected') {
      return dialerCallBlock('disconnected', normalizedPhone)
    }
    const blocked = stopReason(prospectPhone.last_disposition)
    if (blocked) return dialerCallBlock(blocked, normalizedPhone)
  }

  for (const activity of input.activities) {
    const blocked = stopReason(activity.disposition)
      ?? stopReason(activity.outcome)
      ?? (activity.outcome === 'bad_number' ? 'disconnected' : null)
      ?? suppressionReasonFromStatus(activity.phone_status)
    if (blocked) return dialerCallBlock(blocked, normalizedPhone)
  }

  if (!input.callingHoursExempt && !isWithinDialerCallingHours(input.now)) {
    return dialerCallBlock('outside_calling_hours', normalizedPhone)
  }

  return { allowed: true, normalizedPhone }
}

function suppressionReasonFromStatus(raw: string | null | undefined): DialerCallBlockReason | null {
  const value = String(raw ?? '').trim().toLowerCase()
  if (!value || value === 'verified') return null
  if (value === 'dnc') return 'do_not_call'
  if (value === 'wrong_number') return 'wrong_number'
  if (value === 'spam' || value === 'blocked') return 'blocked_number'
  if (value === 'disconnected') return 'disconnected'
  return null
}
