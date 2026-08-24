import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import {
  listProspectingCampaignMemberContacts,
  reviewProspectingCampaignSmsRecipient,
} from '@/lib/server/prospecting-campaign-member-contacts'

export const dynamic = 'force-dynamic'

type RouteParams = { params: Promise<{ id: string; memberId: string }> }

export async function GET(_request: Request, { params }: RouteParams) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id, memberId } = await params
    return prospectingJson(await listProspectingCampaignMemberContacts(actor, id, memberId))
  } catch (error) {
    return prospectingError(error)
  }
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const { id, memberId } = await params
    const body = await request.json() as { contactId?: unknown }
    const contactId = typeof body.contactId === 'string' ? body.contactId : ''
    return prospectingJson({ selection: await reviewProspectingCampaignSmsRecipient(actor, id, memberId, contactId) })
  } catch (error) {
    return prospectingError(error)
  }
}
