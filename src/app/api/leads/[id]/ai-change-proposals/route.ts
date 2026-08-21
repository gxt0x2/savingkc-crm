import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  decideAiChangeProposalForLead,
  getAiChangeProposalsForLead,
} from '@/lib/server/ai-change-proposals'
import { DialerSessionError, isUuid } from '@/lib/server/dialer-session-engine'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE = { 'Cache-Control': 'private, no-store', Vary: 'Cookie' }

function failure(error: unknown) {
  if (error instanceof DialerSessionError) return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: NO_STORE })
  console.error('[leads/ai-change-proposals] Unexpected failure', error)
  return NextResponse.json({ error: 'AI change review is unavailable', code: 'ai_change_proposal_unavailable' }, { status: 503, headers: NO_STORE })
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  try {
    const { id } = await context.params
    if (!isUuid(id)) return NextResponse.json({ error: 'Invalid lead id' }, { status: 400, headers: NO_STORE })
    return NextResponse.json({ proposals: await getAiChangeProposalsForLead(id) }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE })
  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400, headers: NO_STORE })
  }
  const decision = body.decision === 'approved' || body.decision === 'rejected' ? body.decision : null
  const proposalId = typeof body.proposalId === 'string' ? body.proposalId.trim() : ''
  const decisionKey = typeof body.decisionKey === 'string' ? body.decisionKey.trim() : ''
  if (!decision || !isUuid(proposalId) || decisionKey.length < 8 || decisionKey.length > 160) {
    return NextResponse.json({ error: 'Invalid AI change decision' }, { status: 400, headers: NO_STORE })
  }
  try {
    const { id } = await context.params
    if (!isUuid(id)) return NextResponse.json({ error: 'Invalid lead id' }, { status: 400, headers: NO_STORE })
    const proposal = await decideAiChangeProposalForLead({
      actor,
      leadId: id,
      proposalId,
      decision,
      decisionKey,
      note: typeof body.note === 'string' ? body.note : null,
    })
    return NextResponse.json({ proposal }, { headers: NO_STORE })
  } catch (error) {
    return failure(error)
  }
}
