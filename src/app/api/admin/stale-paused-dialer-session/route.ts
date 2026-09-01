import { NextRequest, NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { previewWriteBlocked } from '@/lib/preview-safety'
import {
  StalePausedDialerSessionError,
  clearStalePausedDialerSession,
  findStalePausedDialerHardStop,
  listStalePausedDialerHardStops,
} from '@/lib/server/stale-paused-dialer-session'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store' }

function response(error: unknown) {
  if (error instanceof StalePausedDialerSessionError) {
    return NextResponse.json({ error: error.message, code: error.code, details: error.details }, { status: error.status, headers: NO_STORE })
  }
  console.error('[admin/stale-paused-dialer-session] Unexpected failure', error)
  return NextResponse.json({ error: 'Stale paused calling sessions are unavailable', code: 'stale_session_lookup_unavailable' }, { status: 503, headers: NO_STORE })
}

export async function GET(request: NextRequest) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized
  try {
    const campaignId = new URL(request.url).searchParams.get('campaign_id')
    const actor = await resolveAuthenticatedActor()
    const hardStop = await findStalePausedDialerHardStop({ actor, campaignId })
    return NextResponse.json({
      hardStop,
      items: await listStalePausedDialerHardStops(),
    }, { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized
  if (previewWriteBlocked('POST', '/api/admin/stale-paused-dialer-session')) {
    return NextResponse.json({ error: 'Preview cannot clear a live calling session', code: 'preview_write_blocked' }, { status: 403, headers: NO_STORE })
  }
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }
  const actor = await resolveAuthenticatedActor()
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!sessionId) {
    const current = await findStalePausedDialerHardStop({ actor, campaignId: typeof body.campaignId === 'string' ? body.campaignId : null })
    if (!current) {
      return NextResponse.json({ error: 'No stale paused calling session is blocking the floor', code: 'session_not_stale_paused' }, { status: 409, headers: NO_STORE })
    }
    try {
      return NextResponse.json(await clearStalePausedDialerSession({
        sessionId: current.sessionId,
        actorEmail: actor?.email || 'admin-api',
        reason: typeof body.reason === 'string' ? body.reason : 'stale_paused_session_cleared',
      }), { headers: NO_STORE })
    } catch (error) {
      return response(error)
    }
  }
  try {
    return NextResponse.json(await clearStalePausedDialerSession({
      sessionId,
      actorEmail: actor?.email || 'admin-api',
      reason: typeof body.reason === 'string' ? body.reason : 'stale_paused_session_cleared',
    }), { headers: NO_STORE })
  } catch (error) {
    return response(error)
  }
}
