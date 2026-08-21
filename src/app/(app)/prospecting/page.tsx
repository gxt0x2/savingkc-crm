import { ProspectingWorkspace } from '@/components/prospecting/prospecting-workspace'
import { prospectingCampaignId } from '@/lib/prospecting/audience-handoff'

export const dynamic = 'force-dynamic'

export default async function ProspectingPage({ searchParams }: { searchParams: Promise<{ new?: string; campaign?: string; audience?: string }> }) {
  const params = await searchParams
  const initialCampaignId = prospectingCampaignId(params.campaign)
  const audienceMode = Boolean(initialCampaignId && params.audience === '1')
  return <ProspectingWorkspace key={`${initialCampaignId || 'default'}:${audienceMode ? 'audience' : 'campaigns'}:${params.new === '1' ? 'new' : 'existing'}`} openCreate={params.new === '1'} initialCampaignId={initialCampaignId} audienceMode={audienceMode} />
}
