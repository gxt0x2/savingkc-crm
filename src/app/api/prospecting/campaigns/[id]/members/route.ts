import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { parseLeadIds } from '@/lib/prospecting/campaign-contract'
import { enrollProspectingCampaignMembers } from '@/lib/server/prospecting-campaigns'

export const dynamic = 'force-dynamic'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as { leadIds?: unknown }
    return prospectingJson({ enrollment: await enrollProspectingCampaignMembers(actor, (await params).id, parseLeadIds(body.leadIds)) })
  } catch (error) {
    return prospectingError(error)
  }
}
