import { normalizePhoneToE164 } from '@/lib/phone-normalize'

export interface CallLogCommand {
  event: 'started' | 'ended'
  phone: string
  leadId: string | null
  prospectPhoneId: string | null
  clientAttemptId: string | null
  durationSeconds: number
  status: string | null
  outcome: string | null
  disposition: string | null
  fromNumber: string | null
}

export type CallLogCommandResult =
  | { ok: true; command: CallLogCommand }
  | { ok: false; error: string }

function text(value: unknown, maximum = 100): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maximum) : null
}

export function buildCallLogCommand(input: unknown): CallLogCommandResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Call event required' }
  }
  const body = input as Record<string, unknown>
  const phone = normalizePhoneToE164(text(body.phone) || text(body.to_number) || '')
  if (!phone) return { ok: false, error: 'Valid phone required' }

  const rawEvent = text(body.event)
  const hasFinalOutcome = Boolean(text(body.status) || text(body.outcome) || text(body.disposition))
  let event: 'started' | 'ended' | null = null
  if (rawEvent === 'started' || rawEvent === 'ended') event = rawEvent
  else if (rawEvent) return { ok: false, error: 'Valid call event required' }
  else if (hasFinalOutcome) event = 'ended'
  if (!event) return { ok: false, error: 'Valid call event required' }

  const rawDuration = typeof body.duration === 'number'
    ? body.duration
    : typeof body.duration_seconds === 'number' ? body.duration_seconds : 0

  return {
    ok: true,
    command: {
      event,
      phone,
      leadId: text(body.lead_id),
      prospectPhoneId: text(body.prospect_phone_id),
      clientAttemptId: text(body.clientAttemptId),
      durationSeconds: Number.isFinite(rawDuration) ? Math.max(0, Math.min(86_400, Math.round(rawDuration))) : 0,
      status: text(body.status) || text(body.call_status) || text(body.dial_status),
      outcome: text(body.outcome),
      disposition: text(body.disposition),
      fromNumber: normalizePhoneToE164(text(body.from_number) || ''),
    },
  }
}
