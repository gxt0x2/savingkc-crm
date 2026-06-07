// Canonical call-disposition taxonomy for the dialer.
//
// HISTORY / WHY THIS EXISTS
// -------------------------
// The dialer used to speak two different disposition "languages" that never
// overlapped:
//
//   • The call-summary modal emitted: answered, no_answer, bad_number,
//     left_vm, dnc_contact, dnc_number.
//   • The heir panel decided "is this the verified number?" by checking a
//     totally different set: spoke_with_owner, callback_requested,
//     appointment_set, deal_potential, offer_made, not_interested, dnc.
//
// Because the two sets had ZERO words in common, a heir phone could never be
// marked "verified", and the per-phone call button (disabled when attempted &&
// !verified) greyed out forever after the first call — regardless of which
// outcome the agent picked. The lead PATCH route (src/app/api/leads/route.ts)
// already speaks the second vocabulary, so THAT is the canonical one. This
// module is the single source of truth; the modal, the heir panel, and the
// telephony bar all import from here.

export type DispositionGroup = 'reached' | 'no_contact' | 'stop'

export type DispositionId =
  // Reached the person on the line
  | 'spoke_with_owner'
  | 'callback_requested'
  | 'appointment_set'
  | 'deal_potential'
  | 'offer_made'
  | 'not_interested'
  // Tried but did not reach a person — safe to dial again
  | 'no_answer'
  | 'left_voicemail'
  | 'busy'
  // Stop dialing this number / lead
  | 'wrong_number'
  | 'disconnected'
  | 'dnc'
  | 'dead'

// Back-compat alias — older code imported `DispositionType` from the modal.
export type DispositionType = DispositionId

export type DispositionTone = 'success' | 'warning' | 'info' | 'neutral' | 'danger' | 'critical'

export interface DispositionDef {
  id: DispositionId
  label: string
  group: DispositionGroup
  tone: DispositionTone
  icon: string
  /** Agent actually reached this person → the number is verified to be theirs. */
  reached: boolean
  /** Agent asked to be called back later. */
  callback?: boolean
  /** An appointment was booked. */
  appointment?: boolean
  /** This specific number should stop being auto-dialed (wrong/disconnected/DNC). */
  stopsNumber?: boolean
  /** Whole lead is dead — rolls up to leads.station = 'dead'. */
  dead?: boolean
  /** Do-not-contact flag. */
  dnc?: boolean
  /** Requires a reason before it can be saved (currently: dead). */
  requiresReason?: boolean
  /** Short hint shown under the label in the modal. */
  hint?: string
}

export const DIALER_DISPOSITIONS: DispositionDef[] = [
  // --- Reached the person ---
  { id: 'spoke_with_owner', label: 'Reached Heir', group: 'reached', tone: 'success', icon: 'check_circle', reached: true, hint: 'Confirmed identity' },
  { id: 'callback_requested', label: 'Callback', group: 'reached', tone: 'info', icon: 'schedule', reached: true, callback: true, hint: 'Call back later' },
  { id: 'appointment_set', label: 'Appointment Set', group: 'reached', tone: 'success', icon: 'event_available', reached: true, appointment: true },
  { id: 'deal_potential', label: 'Interested', group: 'reached', tone: 'success', icon: 'local_fire_department', reached: true, hint: 'Deal potential' },
  { id: 'offer_made', label: 'Offer Made', group: 'reached', tone: 'success', icon: 'request_quote', reached: true },
  { id: 'not_interested', label: 'Not Interested', group: 'reached', tone: 'warning', icon: 'do_not_disturb_on', reached: true },
  // --- Did not reach (retryable) ---
  { id: 'no_answer', label: 'No Answer', group: 'no_contact', tone: 'neutral', icon: 'no_answer_badge', reached: false },
  { id: 'left_voicemail', label: 'Left Voicemail', group: 'no_contact', tone: 'info', icon: 'voicemail', reached: false },
  { id: 'busy', label: 'Busy', group: 'no_contact', tone: 'neutral', icon: 'phone_paused', reached: false },
  // --- Stop ---
  { id: 'wrong_number', label: 'Wrong Number', group: 'stop', tone: 'danger', icon: 'phone_disabled', reached: false, stopsNumber: true, hint: 'Not this person' },
  { id: 'disconnected', label: 'Disconnected', group: 'stop', tone: 'danger', icon: 'error', reached: false, stopsNumber: true, hint: 'Bad number' },
  { id: 'dnc', label: 'Do Not Call', group: 'stop', tone: 'critical', icon: 'block', reached: false, stopsNumber: true, dnc: true },
  { id: 'dead', label: 'Dead Lead', group: 'stop', tone: 'critical', icon: 'cancel', reached: false, dead: true, requiresReason: true, hint: 'Why? (required)' },
]

const BY_ID = new Map<string, DispositionDef>(DIALER_DISPOSITIONS.map((d) => [d.id, d]))

// Legacy / alternate spellings → canonical id. Anything not listed here that is
// already a canonical id passes through unchanged.
const LEGACY_ALIASES: Record<string, DispositionId> = {
  answered: 'spoke_with_owner',
  contact: 'spoke_with_owner',
  spoke_with_seller: 'spoke_with_owner',
  reached: 'spoke_with_owner',
  left_vm: 'left_voicemail',
  voicemail: 'left_voicemail',
  voicemail_left: 'left_voicemail',
  vm: 'left_voicemail',
  bad_number: 'disconnected',
  not_in_service: 'disconnected',
  dnc_contact: 'dnc',
  dnc_number: 'dnc',
  do_not_call: 'dnc',
  callback: 'callback_requested',
  appointment: 'appointment_set',
  appt_set: 'appointment_set',
  interested: 'deal_potential',
  offer: 'offer_made',
}

/** Map any stored / legacy disposition string to its canonical id. */
export function normalizeDisposition(raw: string | null | undefined): DispositionId | null {
  if (!raw) return null
  const key = String(raw).trim().toLowerCase()
  if (!key) return null
  if (BY_ID.has(key)) return key as DispositionId
  return LEGACY_ALIASES[key] ?? null
}

export function getDisposition(raw: string | null | undefined): DispositionDef | null {
  const id = normalizeDisposition(raw)
  return id ? BY_ID.get(id) ?? null : null
}

/** True when the agent reached the person → the number is verified to be theirs. */
export function isReachedDisposition(raw: string | null | undefined): boolean {
  return Boolean(getDisposition(raw)?.reached)
}

export function isDeadDisposition(raw: string | null | undefined): boolean {
  return Boolean(getDisposition(raw)?.dead)
}

export function isCallbackDisposition(raw: string | null | undefined): boolean {
  return Boolean(getDisposition(raw)?.callback)
}

export function dispositionStopsNumber(raw: string | null | undefined): boolean {
  return Boolean(getDisposition(raw)?.stopsNumber)
}

export function dispositionRequiresReason(raw: string | null | undefined): boolean {
  return Boolean(getDisposition(raw)?.requiresReason)
}

/** Human label for any stored / legacy disposition value. */
export function dispositionLabel(raw: string | null | undefined): string {
  if (!raw) return ''
  const def = getDisposition(raw)
  if (def) return def.label
  return String(raw)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

export {
  DEAD_REASONS,
  cleanDeadReason,
  deadReasonLabel,
  isValidDeadReason,
  type DeadReasonDef,
} from './lead-outcomes'
