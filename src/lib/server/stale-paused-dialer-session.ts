import { supabase } from '@/lib/supabase-lazy'
import type { AuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  isStalePausedDialerSession,
  stalePausedHardStopMessage,
  stalePausedReasons,
  type StalePausedDialerHardStop,
} from '@/lib/dialer-stale-paused-session'
import { isUuid, parseDialerSession, type DialerSessionState } from '@/lib/server/dialer-session-engine'

export class StalePausedDialerSessionError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
    public readonly details?: StalePausedDialerHardStop,
  ) {
    super(message)
    this.name = 'StalePausedDialerSessionError'
  }
}

type ListedStaleSession = {
  id?: unknown
  status?: unknown
  actorEmail?: unknown
  agentName?: unknown
  prospectingCampaignId?: unknown
  campaignName?: unknown
  startedAt?: unknown
  pausedAt?: unknown
  endedAt?: unknown
  attemptCountToday?: unknown
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toHardStop(row: ListedStaleSession, now = new Date()): StalePausedDialerHardStop | null {
  const sessionId = text(row.id)
  const status = text(row.status)
  const actorEmail = text(row.actorEmail)
  const startedAt = text(row.startedAt)
  const attemptCountToday = Number(row.attemptCountToday) || 0
  const endedAt = text(row.endedAt) || null
  const pausedAt = text(row.pausedAt) || null
  if (!isUuid(sessionId) || status !== 'paused' || !actorEmail || !startedAt) return null
  const reasons = stalePausedReasons({
    status,
    endedAt,
    pausedAt,
    attemptCountToday,
    now,
  })
  if (reasons.length === 0) return null
  const campaignId = text(row.prospectingCampaignId)
  return {
    code: 'stale_paused_session_blocks_start',
    sessionId,
    campaignId: isUuid(campaignId) ? campaignId : null,
    campaignName: text(row.campaignName),
    actorEmail,
    actorName: text(row.agentName) || actorEmail,
    status: 'paused',
    pausedAt,
    startedAt,
    attemptCountToday,
    reasons,
    cannotStartNew: true,
    andonCapable: true,
  }
}

function pickHardStop(
  stops: StalePausedDialerHardStop[],
  input: { actorEmail?: string; campaignId?: string | null },
): StalePausedDialerHardStop | null {
  const actorEmail = input.actorEmail?.trim().toLowerCase() || ''
  const campaignId = input.campaignId || null
  return stops.find((stop) => actorEmail && stop.actorEmail === actorEmail)
    || stops.find((stop) => campaignId && stop.campaignId === campaignId)
    || stops[0]
    || null
}

export async function listStalePausedDialerHardStops(): Promise<StalePausedDialerHardStop[]> {
  const { data, error } = await supabase.rpc('list_stale_paused_dialer_sessions_v1')
  if (error) {
    throw new StalePausedDialerSessionError('stale_session_lookup_unavailable', 503, 'Stale paused calling sessions could not be loaded')
  }
  if (!Array.isArray(data)) return []
  return data.flatMap((row) => {
    const stop = toHardStop(row as ListedStaleSession)
    return stop ? [stop] : []
  })
}

export async function findStalePausedDialerHardStop(input: {
  actor?: AuthenticatedActor | null
  campaignId?: string | null
} = {}): Promise<StalePausedDialerHardStop | null> {
  const stops = await listStalePausedDialerHardStops()
  return pickHardStop(stops, {
    actorEmail: input.actor?.email,
    campaignId: input.campaignId,
  })
}

export async function clearStalePausedDialerSession(input: {
  sessionId: string
  actorEmail: string
  reason?: string | null
}): Promise<{ cleared: boolean; alreadyEnded: boolean; session: DialerSessionState; hardStop: null }> {
  if (!isUuid(input.sessionId)) {
    throw new StalePausedDialerSessionError('invalid_session_id', 400, 'Dialer session is invalid')
  }
  const actorEmail = input.actorEmail.trim().toLowerCase()
  if (!actorEmail) {
    throw new StalePausedDialerSessionError('invalid_actor', 400, 'A signed-in operator is required to clear a stale paused session')
  }
  const { data, error } = await supabase.rpc('clear_stale_paused_dialer_session_v1', {
    p_session_id: input.sessionId,
    p_actor_email: actorEmail,
    p_reason: input.reason?.trim() || 'stale_paused_session_cleared',
  })
  if (error) {
    const detail = `${error.message || ''} ${error.code || ''}`.toLowerCase()
    if (detail.includes('session_not_found')) {
      throw new StalePausedDialerSessionError('session_not_found', 404, 'Dialer session not found')
    }
    if (detail.includes('session_not_stale_paused')) {
      throw new StalePausedDialerSessionError('session_not_stale_paused', 409, 'This calling session is not a stale paused hard stop')
    }
    if (detail.includes('call_in_progress')) {
      throw new StalePausedDialerSessionError('call_in_progress', 409, 'Finish the live call before clearing this paused session')
    }
    throw new StalePausedDialerSessionError('stale_session_clear_unavailable', 503, 'The stale paused session could not be cleared')
  }
  const payload = data as { cleared?: unknown; alreadyEnded?: unknown; session?: unknown } | null
  return {
    cleared: payload?.cleared === true,
    alreadyEnded: payload?.alreadyEnded === true,
    session: parseDialerSession(payload?.session),
    hardStop: null,
  }
}

export function hardStopFromOpenSession(
  session: Pick<DialerSessionState, 'id' | 'status' | 'actorEmail' | 'agentName' | 'startedAt' | 'pausedAt' | 'endedAt' | 'settingsSnapshot'> | null,
  attemptCountToday: number,
  now = new Date(),
): StalePausedDialerHardStop | null {
  if (!session || !isStalePausedDialerSession({
    status: session.status,
    endedAt: session.endedAt,
    pausedAt: session.pausedAt,
    attemptCountToday,
    now,
  })) return null
  const campaignId = typeof session.settingsSnapshot.prospectingCampaignId === 'string'
    ? session.settingsSnapshot.prospectingCampaignId
    : null
  const campaignName = typeof session.settingsSnapshot.campaignName === 'string'
    ? session.settingsSnapshot.campaignName
    : ''
  return {
    code: 'stale_paused_session_blocks_start',
    sessionId: session.id,
    campaignId: campaignId && isUuid(campaignId) ? campaignId : null,
    campaignName,
    actorEmail: session.actorEmail,
    actorName: session.agentName,
    status: 'paused',
    pausedAt: session.pausedAt,
    startedAt: session.startedAt,
    attemptCountToday,
    reasons: stalePausedReasons({
      status: session.status,
      endedAt: session.endedAt,
      pausedAt: session.pausedAt,
      attemptCountToday,
      now,
    }),
    cannotStartNew: true,
    andonCapable: true,
  }
}

export { stalePausedHardStopMessage }
