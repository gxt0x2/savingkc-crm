import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingJson } from '@/lib/api/prospecting-response'
import { ForeclosureError, prepareForeclosureCall } from '@/lib/server/foreclosure-prospects'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    return prospectingJson(await prepareForeclosureCall(actor, (await context.params).id))
  } catch (error) {
    if (error instanceof ForeclosureError) return prospectingJson({ error: error.message, code: error.code }, { status: error.status })
    console.error('[foreclosure] call prep failed', error)
    return prospectingJson({ error: 'Foreclosure calling is unavailable.', code: 'foreclosure_unavailable' }, { status: 503 })
  }
}
