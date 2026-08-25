import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { launchProspectingDialerCampaign } from '@/lib/server/prospecting-campaigns'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const rawBody = await request.text()
  let body: { startBehavior?: unknown } = {}
  try {
    if (rawBody.trim()) body = JSON.parse(rawBody) as { startBehavior?: unknown }
  } catch {
    return prospectingJson({ error: 'Request body must be valid JSON', code: 'invalid_json' }, { status: 400 })
  }
  const startBehavior = body.startBehavior === undefined ? 'resume' : body.startBehavior
  if (startBehavior !== 'resume' && startBehavior !== 'first_unworked') {
    return prospectingJson({ error: 'Choose Resume where I stopped or First unworked seller', code: 'invalid_start_behavior' }, { status: 400 })
  }
  try {
    return prospectingJson(await launchProspectingDialerCampaign(actor, (await params).id, startBehavior), { status: 201 })
  } catch (error) {
    return prospectingError(error)
  }
}
