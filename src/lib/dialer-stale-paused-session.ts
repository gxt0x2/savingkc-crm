export const CALLING_DAY_TIMEZONE = 'America/Chicago'
export const STALE_PAUSED_SESSION_SLA_MS = 15 * 60 * 1000

export type StalePausedReason = 'zero_attempts_today' | 'paused_past_sla'

export type StalePausedDialerHardStop = {
  code: 'stale_paused_session_blocks_start'
  sessionId: string
  campaignId: string | null
  campaignName: string
  actorEmail: string
  actorName: string
  status: 'paused'
  pausedAt: string | null
  startedAt: string
  attemptCountToday: number
  reasons: StalePausedReason[]
  cannotStartNew: true
  andonCapable: true
}

export function callingDayStartUtc(now = new Date(), timeZone = CALLING_DAY_TIMEZONE): Date {
  const calendar = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
  const probe = new Date(`${calendar}T12:00:00.000Z`)
  const offsetMs = timeZoneOffsetMs(probe, timeZone)
  return new Date(Date.parse(`${calendar}T00:00:00.000Z`) - offsetMs)
}

function timeZoneOffsetMs(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    timeZoneName: 'shortOffset',
    hour: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const label = parts.find((part) => part.type === 'timeZoneName')?.value || 'GMT'
  const match = label.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
  if (!match) return 0
  const sign = match[1] === '-' ? -1 : 1
  return sign * ((Number(match[2]) * 60 + Number(match[3] || 0)) * 60_000)
}

export function stalePausedReasons(input: {
  status: string
  endedAt?: string | null
  pausedAt?: string | null
  attemptCountToday: number
  now?: Date
  slaMs?: number
}): StalePausedReason[] {
  if (input.status !== 'paused' || input.endedAt) return []
  const now = input.now ?? new Date()
  const slaMs = input.slaMs ?? STALE_PAUSED_SESSION_SLA_MS
  const reasons: StalePausedReason[] = []
  if (input.attemptCountToday <= 0) reasons.push('zero_attempts_today')
  const pausedAt = input.pausedAt ? Date.parse(input.pausedAt) : Number.NaN
  if (!Number.isFinite(pausedAt) || now.getTime() - pausedAt >= slaMs) reasons.push('paused_past_sla')
  return reasons
}

export function isStalePausedDialerSession(input: {
  status: string
  endedAt?: string | null
  pausedAt?: string | null
  attemptCountToday: number
  now?: Date
  slaMs?: number
}): boolean {
  return stalePausedReasons(input).length > 0
}

export function stalePausedHardStopMessage(stop: Pick<StalePausedDialerHardStop, 'campaignName' | 'sessionId' | 'reasons' | 'attemptCountToday'>): string {
  const sessionLabel = `session ${stop.sessionId.slice(0, 8)}`
  const campaign = stop.campaignName.trim() || 'the open calling campaign'
  if (stop.reasons.includes('zero_attempts_today')) {
    return `“${campaign}” · ${sessionLabel} is paused with ${stop.attemptCountToday} attempts today. Clear it before starting a new calling session.`
  }
  return `“${campaign}” · ${sessionLabel} has been paused past the 15-minute SLA. Clear it before starting a new calling session.`
}
