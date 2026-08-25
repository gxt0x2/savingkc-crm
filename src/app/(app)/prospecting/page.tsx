import { ProspectingWorkspace } from '@/components/prospecting/prospecting-workspace'
import { ProspectingCallingFloor } from '@/components/prospecting/prospecting-calling-floor'
import { prospectingCampaignId } from '@/lib/prospecting/audience-handoff'

export const dynamic = 'force-dynamic'

export default async function ProspectingPage({ searchParams }: { searchParams: Promise<{ new?: string; campaign?: string; audience?: string; session_id?: string; lead_ids?: string; cohort?: string; preview_campaign?: string }> }) {
  const params = await searchParams
  const previewCampaignId = prospectingCampaignId(params.preview_campaign)
  const executionKey = params.session_id?.trim() || params.lead_ids?.trim() || params.cohort?.trim() || previewCampaignId
  if (executionKey) return <ProspectingCallingFloor key={executionKey} readOnlyPreview={Boolean(previewCampaignId)} previewCampaignId={previewCampaignId} />
  const initialCampaignId = prospectingCampaignId(params.campaign)
  const audienceMode = Boolean(initialCampaignId && params.audience === '1')
  return <ProspectingWorkspace key={`${initialCampaignId || 'default'}:${audienceMode ? 'audience' : 'campaigns'}:${params.new === '1' ? 'new' : 'existing'}`} openCreate={params.new === '1'} initialCampaignId={initialCampaignId} audienceMode={audienceMode} />
}
