import { ProspectingWorkspace } from '@/components/prospecting/prospecting-workspace'
import { ProspectingCallingFloor } from '@/components/prospecting/prospecting-calling-floor'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { previewWriteBlocked } from '@/lib/preview-safety'
import { prospectingCampaignId } from '@/lib/prospecting/audience-handoff'
import { preferredProspectingDialerPickerCampaignId, type ProspectingCampaignDetail, type ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'
import { getProspectingCampaign, listProspectingCampaigns } from '@/lib/server/prospecting-campaigns'

export const dynamic = 'force-dynamic'

export default async function ProspectingPage({ searchParams }: { searchParams: Promise<{ new?: string; campaign?: string; audience?: string; session_id?: string; lead_ids?: string; cohort?: string; preview_campaign?: string }> }) {
  const params = await searchParams
  const previewCampaignId = prospectingCampaignId(params.preview_campaign)
  const executionKey = params.session_id?.trim() || params.lead_ids?.trim() || params.cohort?.trim() || previewCampaignId
  if (executionKey) return <ProspectingCallingFloor key={executionKey} readOnlyPreview={Boolean(previewCampaignId)} previewCampaignId={previewCampaignId} />
  const initialCampaignId = prospectingCampaignId(params.campaign)
  const audienceMode = Boolean(initialCampaignId && params.audience === '1')
  const actor = await resolveAuthenticatedActor()

  if (!actor) {
    return <ProspectingWorkspace key={`${initialCampaignId || 'default'}:${audienceMode ? 'audience' : 'campaigns'}:${params.new === '1' ? 'new' : 'existing'}`} openCreate={params.new === '1'} initialCampaignId={initialCampaignId} audienceMode={audienceMode} />
  }

  let initialCampaigns: ProspectingCampaignSummary[] = []
  let initialSelectedId: string | null = null
  let initialDetail: ProspectingCampaignDetail | null = null
  let initialWritesEnabled = true
  let initialRefreshedAt: string | null = null
  let initialError: string | null = null

  try {
    const initialPage = await listProspectingCampaigns(actor, { limit: 50 })
    initialCampaigns = initialPage.items
    initialSelectedId = preferredProspectingDialerPickerCampaignId(initialCampaigns, null, initialCampaignId)
    if (initialSelectedId) {
      const campaign = await getProspectingCampaign(actor, initialSelectedId)
      // The collapsed dashboard does not render member rows. Keep the first
      // RSC payload small; the audience workbench owns its paginated member read.
      initialDetail = { ...campaign, members: [] }
    }
    initialRefreshedAt = initialDetail ? new Date().toISOString() : null
    initialWritesEnabled = initialSelectedId
      ? !previewWriteBlocked('POST', `/api/prospecting/campaigns/${initialSelectedId}/launch`)
      : true
  } catch (error) {
    initialError = error instanceof Error ? error.message : 'Campaigns could not be loaded'
  }

  return <ProspectingWorkspace
    key={`${initialCampaignId || 'default'}:${audienceMode ? 'audience' : 'campaigns'}:${params.new === '1' ? 'new' : 'existing'}`}
    openCreate={params.new === '1'}
    initialCampaignId={initialCampaignId}
    audienceMode={audienceMode}
    initialCampaigns={initialCampaigns}
    initialSelectedId={initialSelectedId}
    initialDetail={initialDetail}
    initialWritesEnabled={initialWritesEnabled}
    initialRefreshedAt={initialRefreshedAt}
    initialError={initialError}
  />
}
