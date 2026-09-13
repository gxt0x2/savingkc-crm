import { practiceReply } from './workflow/presentation'

export type PhoneSignalKind = 'none' | 'phone_only' | 'callback_request'

/** New visible text only. Quoted history and signatures cannot invent a Lead. */
export function extractPhoneSignal(body: string) {
  const visible = practiceReply(body)
  const kind: PhoneSignalKind = visible.phone
    ? visible.time || visible.askedForCall
      ? 'callback_request'
      : 'phone_only'
    : 'none'
  return {
    phone: visible.phone ?? null,
    requestedTimeText: visible.time ?? null,
    kind,
    createsLead: false,
    createsAppointment: false,
    createsOpportunity: false,
  }
}

export function lockscreenAlertCopy(
  kind: 'callback' | 'phone' | 'missed_call',
) {
  return {
    callback: 'Callback request — open Email',
    phone: 'Phone provided — open Email',
    missed_call: 'Missed call — open Email',
  }[kind]
}

export function canUseUnscopedPushFeed() {
  return false
}
