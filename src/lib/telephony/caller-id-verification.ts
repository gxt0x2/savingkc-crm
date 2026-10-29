/**
 * Mojo Dialer (and similar) caller-ID verification robocalls.
 *
 * These are short system calls, not sellers. The recording callback already
 * keeps the call log. This predicate decides whether that call should leave
 * the active lead pipeline after Whisper returns.
 *
 * PR #729 skips Mojo calendar-reminder emails before they become calls.
 * A verification call is a real Twilio call, so the call log stays. Only the
 * lead is retired, and only when both checks below agree.
 */

export const CALLER_ID_VERIFICATION_ACTOR = 'system:caller_id_verification'
export const CALLER_ID_VERIFICATION_DEAD_REASON = 'spam_vendor_duplicate'
export const CALLER_ID_VERIFICATION_NOTE =
  'Caller ID verification robocall. Marked not a lead. The call log was kept.'

/** Recordings under 5 seconds never reach transcription. 20 seconds still covers the observed 5–8 second scripts. */
export const CALLER_ID_VERIFICATION_MIN_SECONDS = 5
export const CALLER_ID_VERIFICATION_MAX_SECONDS = 20

/**
 * The spoken script is about 60 characters once punctuation is removed.
 * 160 leaves room for Whisper filler. A seller sentence quoted after the
 * script is longer than that and stays a lead.
 */
const CALLER_ID_VERIFICATION_MAX_NORMALIZED_LENGTH = 160

const CALLER_ID_VERIFICATION_PATTERN =
  /\bpress\s+(?:1|one)\b\s+(?:to\s+)?confirm\s+(?:(?:this|your|the)\s+)?caller\s+i\s*d\b/

export function normalizeCallerIdVerificationTranscript(transcript: string): string {
  return transcript
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cheap duration gate. It never decides alone: a short seller call still has
 * to fail the transcript match before it stays a lead.
 */
export function isCallerIdVerificationDuration(durationSeconds: number | null | undefined): boolean {
  return typeof durationSeconds === 'number'
    && Number.isFinite(durationSeconds)
    && durationSeconds >= CALLER_ID_VERIFICATION_MIN_SECONDS
    && durationSeconds <= CALLER_ID_VERIFICATION_MAX_SECONDS
}

export function isCallerIdVerificationTranscript(transcript: string | null | undefined): boolean {
  if (!transcript?.trim()) return false
  const normalized = normalizeCallerIdVerificationTranscript(transcript)
  if (!normalized || normalized.length > CALLER_ID_VERIFICATION_MAX_NORMALIZED_LENGTH) return false
  return CALLER_ID_VERIFICATION_PATTERN.test(normalized)
}

export function isCallerIdVerificationRobocall(input: {
  transcript: string | null | undefined
  durationSeconds: number | null | undefined
}): boolean {
  return isCallerIdVerificationDuration(input.durationSeconds)
    && isCallerIdVerificationTranscript(input.transcript)
}

export function unconfirmedInboundLeadCanBeRetired(lead: {
  classification?: string | null
  station?: string | null
}): boolean {
  const classification = typeof lead.classification === 'string' ? lead.classification.trim().toLowerCase() : ''
  const station = typeof lead.station === 'string' ? lead.station.trim().toLowerCase() : ''
  return classification === '' && station === 'new'
}

export function appendCallerIdVerificationNote(notes: string | null | undefined): string {
  const existing = notes?.trim() ?? ''
  if (!existing) return CALLER_ID_VERIFICATION_NOTE
  if (existing.includes(CALLER_ID_VERIFICATION_NOTE)) return existing
  return `${existing}\n${CALLER_ID_VERIFICATION_NOTE}`
}

export function callerIdVerificationRetirementPatch(nowIso: string, notes: string | null | undefined) {
  return {
    classification: 'dead' as const,
    station: 'dead' as const,
    priority: 'cold' as const,
    opportunity_score: 0,
    dead_reason: CALLER_ID_VERIFICATION_DEAD_REASON,
    dead_at: nowIso,
    dead_by: CALLER_ID_VERIFICATION_ACTOR,
    updated_at: nowIso,
    notes: appendCallerIdVerificationNote(notes),
  }
}

export function isCallerIdVerificationLead(lead: { dead_by?: unknown } | null | undefined): boolean {
  return lead?.dead_by === CALLER_ID_VERIFICATION_ACTOR
}

export function withoutCallerIdVerificationLeads<T extends { dead_by?: unknown }>(leads: T[]): T[] {
  return leads.filter((lead) => !isCallerIdVerificationLead(lead))
}
