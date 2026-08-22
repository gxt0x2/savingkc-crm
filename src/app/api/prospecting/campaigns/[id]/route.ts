import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { getProspectingCampaign, setProspectingCampaignStatus } from '@/lib/server/prospecting-campaigns'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    return prospectingJson({ campaign: await getProspectingCampaign(actor, (await params).id) })
  } catch (error) {
    return prospectingError(error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as { status?: unknown; confirmed?: unknown }
    if (!['active', 'paused', 'archived'].includes(String(body.status))) {
      return prospectingJson({ error: 'Choose active, paused, or archived', code: 'invalid_campaign_status' }, { status: 400 })
    }
    if (body.status === 'active' && body.confirmed !== true) {
      return prospectingJson({ error: 'Review the launch checklist and confirm activation', code: 'activation_confirmation_required' }, { status: 409 })
    }
    return prospectingJson({ campaign: await setProspectingCampaignStatus(
      actor,
      (await params).id,
      body.status as 'active' | 'paused' | 'archived',
    ) })
  } catch (error) {
    return prospectingError(error)
  }
}
