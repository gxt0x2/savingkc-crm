import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { rerunProspectingDialerCampaign } from '@/lib/server/prospecting-campaigns'

export const dynamic = 'force-dynamic'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })

  try {
    return prospectingJson({ campaign: await rerunProspectingDialerCampaign(actor, (await params).id) })
  } catch (error) {
    return prospectingError(error)
  }
}
