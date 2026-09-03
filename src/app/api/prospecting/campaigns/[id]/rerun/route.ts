import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { rerunProspectingDialerCampaign } from '@/lib/server/prospecting-campaigns'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })

  const rawBody = await request.text()
  let body: unknown = {}
  try {
    if (rawBody.trim()) body = JSON.parse(rawBody) as unknown
  } catch {
    return prospectingJson({ error: 'Request body must be valid JSON', code: 'invalid_json' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body) || (body as Record<string, unknown>).confirmed !== true) {
    return prospectingJson({ error: 'Confirm that you want to run this completed list again', code: 'rerun_confirmation_required' }, { status: 400 })
  }

  try {
    return prospectingJson({ campaign: await rerunProspectingDialerCampaign(actor, (await params).id) })
  } catch (error) {
    return prospectingError(error)
  }
}
