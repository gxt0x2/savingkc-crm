import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { parseProspectingDialerSessionSetup } from '@/lib/prospecting/campaign-contract'
import { launchProspectingDialerCampaign } from '@/lib/server/prospecting-campaigns'

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
  try {
    const setup = parseProspectingDialerSessionSetup(body)
    return prospectingJson(await launchProspectingDialerCampaign(actor, (await params).id, setup), { status: 201 })
  } catch (error) {
    return prospectingError(error)
  }
}
