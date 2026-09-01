import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { parseCreateProspectingCampaignInput } from '@/lib/prospecting/campaign-contract'
import { createProspectingCampaign, listProspectingCampaigns } from '@/lib/server/prospecting-campaigns'
import { findStalePausedDialerHardStop } from '@/lib/server/stale-paused-dialer-session'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const params = new URL(request.url).searchParams
    const rawLimit = params.get('limit')
    const [page, hardStop] = await Promise.all([
      listProspectingCampaigns(actor, {
        limit: rawLimit == null ? undefined : Number(rawLimit),
        cursor: params.get('cursor'),
      }),
      findStalePausedDialerHardStop({ actor }).catch(() => null),
    ])
    return prospectingJson({
      ...page,
      hardStop,
    })
  } catch (error) {
    return prospectingError(error)
  }
}

export async function POST(request: Request) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const input = parseCreateProspectingCampaignInput(await request.json())
    return prospectingJson({ campaign: await createProspectingCampaign(actor, input) }, { status: 201 })
  } catch (error) {
    return prospectingError(error)
  }
}
