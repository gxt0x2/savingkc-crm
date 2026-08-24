import type { DialerCallerPlan } from '@/lib/dialer-caller-plan'
import { normalizeDialerCallerPlan } from '@/lib/dialer-caller-plan'
import { dispositionStopsNumber, isReachedDisposition } from '@/lib/dialer-dispositions'

// A queue subject can be either a CRM Lead or an unpromoted source Prospect.
// Campaign enrollment never creates a shadow Lead.
export interface HeirDialerQueueItem {
  prospect_phone_id: string | null
  prospectId: string | null
  phone: string
  heirName: string
  relation: string
  leadId: string | null
  campaignMemberId: string | null
  propertyAddress: string
  deceasedOwnerName: string
}

export interface HeirPhone {
  id: string
  snapshot_id?: string | null
  prospect_id: string | null
  prospect_phone_id: string | null
  number: string
  type: string | null
  connected: string | null
  status?: 'ready' | 'suppressed' | 'removed'
  suppression_reason?: string | null
  attempted: boolean
  last_disposition: string | null
  last_attempt_at: string | null
  is_verified_contact?: boolean
  verified_at?: string | null
  verified_by?: string | null
}

export interface Heir {
  key: string
  contact_name: string
  relationship: string
  address: string | null
  unattempted_count: number
  phones: HeirPhone[]
}

export function dispatchHeirQueue(
  queue: HeirDialerQueueItem[],
  callerId?: string | null,
  callerPlan?: Partial<DialerCallerPlan> | null,
  options?: { autoDial?: boolean; ringCount?: number | null },
  sessionId?: string | null,
) {
  if (queue.length === 0) return
  const detail: { queue: HeirDialerQueueItem[]; callerId?: string; callerPlan?: DialerCallerPlan; autoDial?: boolean; ringCount?: number; sessionId?: string } = { queue }
  if (typeof callerId === 'string' && callerId.trim()) detail.callerId = callerId.trim()
  detail.callerPlan = normalizeDialerCallerPlan(callerPlan, typeof callerId === 'string' ? callerId.trim() : '')
  if (options?.autoDial) detail.autoDial = true
  if (options?.ringCount && options.ringCount > 0) detail.ringCount = options.ringCount
  if (sessionId) detail.sessionId = sessionId
  window.dispatchEvent(new CustomEvent('open-dialer-queue', { detail }))
}

export function isVerifiedPhone(phone: HeirPhone): boolean {
  return Boolean(phone.is_verified_contact) || isReachedDisposition(phone.last_disposition)
}

export function verifiedPhoneOf(heir: Heir): HeirPhone | null {
  return heir.phones.find(isVerifiedPhone) ?? null
}

export function sourceProspectPhoneId(phone: HeirPhone): string | null {
  if (phone.prospect_phone_id) return phone.prospect_phone_id
  return phone.snapshot_id ? null : phone.id
}

export function isAutoCallablePhone(phone: HeirPhone): boolean {
  return Boolean(phone.number?.trim())
    && phone.status !== 'suppressed'
    && phone.status !== 'removed'
    && phone.connected?.toLowerCase() !== 'disconnected'
    && !dispositionStopsNumber(phone.last_disposition)
}
