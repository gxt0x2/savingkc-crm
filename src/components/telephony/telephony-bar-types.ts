import type { DialerCallerPlan } from '@/lib/dialer-caller-plan'
import type { HeirDialerQueueItem } from '@/lib/heir-dialer-queue'

export type CallStatus = 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type TwilioDevice = any

export type TwilioErrorLike = {
  code?: number
  message?: string
  explanation?: string
  name?: string
  causes?: unknown[]
  originalError?: unknown
}

// A single entry in the heir-dialer queue. The property stays pinned (leadId +
// propertyAddress + deceasedOwnerName) while heirName/relation/phone rotate per
// item.
export type HeirQueueItem = HeirDialerQueueItem

export interface DialerPanelProps {
  open: boolean
  onClose: () => void
  onStatusChange?: (status: CallStatus) => void
  pendingDial?: { phone: string; name: string; leadId: string; callerId?: string | null } | null
  pendingQueue?: HeirQueueItem[] | null
  pendingQueueCallerId?: string | null
  pendingQueueCallerPlan?: DialerCallerPlan | null
  pendingQueueAutoDial?: boolean
  pendingSessionId?: string | null
  /** How many rings to allow before giving up; maps to the Twilio Dial timeout. */
  pendingQueueRingCount?: number | null
  presentation?: 'modal' | 'dock' | 'workspace'
  signedInEmail?: string | null
}
