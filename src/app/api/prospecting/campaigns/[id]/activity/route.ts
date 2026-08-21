import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { listProspectingCampaignActivity } from '@/lib/server/prospecting-campaign-activity'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  try {
    return prospectingJson(await listProspectingCampaignActivity(actor, (await params).id, {
      limit: Number(url.searchParams.get('limit') || 25),
      cursor: url.searchParams.get('cursor'),
    }))
  } catch (error) {
    return prospectingError(error)
  }
}
