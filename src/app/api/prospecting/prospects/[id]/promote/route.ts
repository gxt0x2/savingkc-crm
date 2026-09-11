import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  assertDialerMutationControl,
  dialerMutationControlErrorResponse,
} from '@/lib/api/dialer-mutation-control'
import { prospectingJson } from '@/lib/api/prospecting-response'
import {
  promoteProspectingProspect,
  ProspectPromotionError,
} from '@/lib/server/prospecting-prospect-promotion'

export const dynamic = 'force-dynamic'

function text(value: unknown, maxLength = 120): string | null {
  if (typeof value !== 'string') return null
  const normalized = value.trim()
  return normalized ? normalized.slice(0, maxLength) : null
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })

  try {
    const { id } = await context.params
    const prospectId = text(id, 80)
    const input = await request.json() as Record<string, unknown>
    if (!prospectId) return prospectingJson({ error: 'Source Prospect is required' }, { status: 400 })

    await assertDialerMutationControl({
      request,
      actor,
      sessionId: text(input.dialerSessionId, 80),
      subject: {
        prospectId,
        campaignMemberId: text(input.campaignMemberId, 80),
      },
      protectMatchingOpenSession: true,
    })

    const result = await promoteProspectingProspect({
      actor,
      prospectId,
      presentedPhone: text(input.presentedPhone, 40),
    })
    return prospectingJson(result, { status: result.promoted ? 201 : 200 })
  } catch (error) {
    const controlResponse = dialerMutationControlErrorResponse(error)
    if (controlResponse) return controlResponse
    if (error instanceof ProspectPromotionError) return prospectingJson({ error: error.message }, { status: error.status })
    console.error('[prospecting/prospects/promote] failed', error)
    return prospectingJson({ error: 'The record could not be marked as a Lead' }, { status: 500 })
  }
}
