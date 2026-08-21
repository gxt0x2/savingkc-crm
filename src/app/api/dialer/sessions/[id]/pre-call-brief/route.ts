import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { getDialerPreCallBrief } from '@/lib/server/dialer-pre-call-brief'
import { DialerSessionError } from '@/lib/server/dialer-session-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  const started = performance.now()
  try {
    const { id } = await context.params
    const brief = await getDialerPreCallBrief(actor, id)
    return NextResponse.json({ brief }, {
      headers: { ...NO_STORE, 'Server-Timing': `precall;dur=${(performance.now() - started).toFixed(1)};desc="Pre-call brief", source_rows;desc="${brief.sourceRowCount} bounded rows"` },
    })
  } catch (error) {
    if (error instanceof DialerSessionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
    }
    console.error('[dialer/pre-call-brief] Unexpected failure', error)
    return NextResponse.json({ error: 'Pre-call brief is unavailable', code: 'pre_call_brief_unavailable' }, { status: 503, headers: NO_STORE })
  }
}
