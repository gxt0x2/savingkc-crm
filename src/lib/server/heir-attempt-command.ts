import {
  isDeadDisposition,
  isReachedDisposition,
  cleanDeadReason,
  normalizeDisposition,
  type DispositionId,
} from '@/lib/dialer-dispositions'

export interface HeirAttemptCommand {
  prospectPhoneId: string
  disposition: DispositionId
  notes: string | null
  requestedLeadId: string | null
  requestedProspectId: string | null
  campaignMemberId: string | null
  durationSeconds: number | null
  markAsLead: boolean
  verified: boolean | null
  deadReason: string | null
  appointmentAt: string | null
  clientAttemptId: string | null
  reached: boolean
  dead: boolean
}

export type HeirAttemptCommandResult =
  | { ok: true; command: HeirAttemptCommand }
  | { ok: false; error: string }

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

export function buildHeirAttemptCommand(input: unknown, now = Date.now()): HeirAttemptCommandResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Heir call outcome required' }
  }
  const body = input as Record<string, unknown>
  const prospectPhoneId = cleanText(body.prospect_phone_id, 100)
  const disposition = normalizeDisposition(typeof body.disposition === 'string' ? body.disposition : null)
  if (!prospectPhoneId || !disposition) {
    return { ok: false, error: 'Choose a valid heir phone and call outcome' }
  }

  const duration = typeof body.duration === 'number' && Number.isFinite(body.duration)
    ? Math.max(0, Math.min(86_400, Math.round(body.duration)))
    : null
  const verified = typeof body.verified === 'boolean' ? body.verified : null
  const dead = isDeadDisposition(disposition)
  const deadReason = cleanDeadReason(body.dead_reason)
  if (dead && !deadReason) return { ok: false, error: 'Choose why this lead is dead' }
  const markAsLead = body.mark_as_lead === true
  if (markAsLead && !isReachedDisposition(disposition)) {
    return { ok: false, error: 'Reach and verify this heir before making them the primary contact' }
  }

  const appointmentAtText = cleanText(body.appointmentAt, 100)
  let appointmentAt: string | null = null
  if (disposition === 'appointment_set') {
    const appointmentMs = appointmentAtText ? new Date(appointmentAtText).getTime() : Number.NaN
    const latestAllowed = now + (2 * 365 * 24 * 60 * 60 * 1000)
    if (!Number.isFinite(appointmentMs) || appointmentMs <= now || appointmentMs > latestAllowed) {
      return { ok: false, error: 'Choose the real appointment date and time before saving Appointment Set.' }
    }
    appointmentAt = new Date(appointmentMs).toISOString()
  }

  return {
    ok: true,
    command: {
      prospectPhoneId,
      disposition,
      notes: cleanText(body.notes, 5_000),
      requestedLeadId: cleanText(body.lead_id, 100),
      requestedProspectId: cleanText(body.prospect_id, 100),
      campaignMemberId: cleanText(body.campaign_member_id, 100),
      durationSeconds: duration,
      markAsLead,
      verified,
      deadReason: dead ? deadReason : null,
      appointmentAt,
      clientAttemptId: cleanText(body.clientAttemptId, 100),
      reached: isReachedDisposition(disposition),
      dead,
    },
  }
}
