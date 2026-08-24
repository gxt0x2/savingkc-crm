import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { parseLeadIds } from '@/lib/prospecting/campaign-contract'
import { enrollCountyProspectingCampaignMembers, enrollProspectingCampaignMembers, removeProspectingCampaignMember } from '@/lib/server/prospecting-campaigns'
import { enrollProspectingAudienceSelection, parseProspectingAudienceSelection } from '@/lib/server/prospecting-audience-selection'
import { CAMPAIGN_MEMBER_FILTERS, listProspectingCampaignMembers, type CampaignMemberFilter } from '@/lib/server/prospecting-campaign-members'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  const url = new URL(request.url)
  const status = url.searchParams.get('status') || 'all'
  try {
    if (!CAMPAIGN_MEMBER_FILTERS.includes(status as CampaignMemberFilter)) {
      return prospectingJson({ error: 'Campaign audience status is invalid', code: 'invalid_member_status' }, { status: 400 })
    }
    return prospectingJson(await listProspectingCampaignMembers(actor, (await params).id, {
      limit: Number(url.searchParams.get('limit') || 50),
      cursor: url.searchParams.get('cursor'),
      status: status as CampaignMemberFilter,
      query: url.searchParams.get('q'),
    }))
  } catch (error) {
    return prospectingError(error)
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as { leadIds?: unknown; selection?: unknown; countyAudience?: unknown }
    const campaignId = (await params).id
    const countyAudience = body.countyAudience && typeof body.countyAudience === 'object' && !Array.isArray(body.countyAudience)
      ? body.countyAudience as Record<string, unknown>
      : null
    const enrollment = countyAudience
      ? await enrollCountyProspectingCampaignMembers(actor, campaignId, {
          savedView: String(countyAudience.savedView || '') as 'tax_2yr' | 'tax_3yr_plus',
          deceasedFilter: String(countyAudience.deceasedFilter || '') as 'all' | 'deceased' | 'non_deceased',
          propertyFilter: String(countyAudience.propertyFilter || '') as 'all' | 'residential' | 'land' | 'unknown',
          reviewedCount: Number(countyAudience.reviewedCount),
        })
      : body.selection
      ? await enrollProspectingAudienceSelection(actor, campaignId, parseProspectingAudienceSelection(body.selection))
      : await enrollProspectingCampaignMembers(actor, campaignId, parseLeadIds(body.leadIds))
    return prospectingJson({ enrollment })
  } catch (error) {
    return prospectingError(error)
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as { memberId?: unknown }
    const memberId = typeof body.memberId === 'string' ? body.memberId : ''
    return prospectingJson({ member: await removeProspectingCampaignMember(actor, (await params).id, memberId) })
  } catch (error) {
    return prospectingError(error)
  }
}
