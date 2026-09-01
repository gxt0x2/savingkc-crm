import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { prospectingError, prospectingJson } from '@/lib/api/prospecting-response'
import { parseCreateProspectingCampaignInput, parseProspectingDialerSessionSetup } from '@/lib/prospecting/campaign-contract'
import { previewWriteBlocked } from '@/lib/preview-safety'
import { getProspectingCampaign, saveProspectingDialerPreset, setProspectingCampaignStatus, updateProspectingCampaignDraft } from '@/lib/server/prospecting-campaigns'
import { findStalePausedDialerHardStop } from '@/lib/server/stale-paused-dialer-session'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const campaignId = (await params).id
    const writesEnabled = !previewWriteBlocked('POST', `/api/prospecting/campaigns/${campaignId}/launch`)
    const [campaign, hardStop] = await Promise.all([
      getProspectingCampaign(actor, campaignId),
      findStalePausedDialerHardStop({ actor, campaignId }).catch(() => null),
    ])
    return prospectingJson({
      campaign,
      capabilities: {
        writesEnabled,
        canClearStalePausedSession: writesEnabled,
      },
      hardStop,
    })
  } catch (error) {
    return prospectingError(error)
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return prospectingJson({ error: 'Unauthorized' }, { status: 401 })
  try {
    const body = await request.json() as { status?: unknown; confirmed?: unknown; setup?: unknown; dialerPreset?: unknown }
    if (body.dialerPreset !== undefined) {
      return prospectingJson({ dialerPreset: await saveProspectingDialerPreset(
        actor,
        (await params).id,
        parseProspectingDialerSessionSetup(body.dialerPreset),
      ) })
    }
    if (body.setup !== undefined) {
      return prospectingJson({ campaign: await updateProspectingCampaignDraft(
        actor,
        (await params).id,
        parseCreateProspectingCampaignInput(body.setup),
      ) })
    }
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
