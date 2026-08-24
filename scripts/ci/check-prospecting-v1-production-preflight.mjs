const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceKey) {
  console.error('Prospecting V1 preflight failed: production Supabase credentials are unavailable.')
  process.exit(1)
}

const headers = {
  apikey: serviceKey,
  authorization: `Bearer ${serviceKey}`,
  Prefer: 'count=exact',
}

async function countRows(table, filter = '') {
  const url = new URL(`/rest/v1/${table}`, supabaseUrl)
  url.searchParams.set('select', 'id')
  if (filter) {
    for (const [key, value] of new URLSearchParams(filter)) url.searchParams.set(key, value)
  }
  const response = await fetch(url, { method: 'HEAD', headers })
  const range = response.headers.get('content-range') || ''
  const rawCount = range.includes('/') ? range.split('/').at(-1) : null
  return {
    reachable: response.ok,
    status: response.status,
    count: rawCount && rawCount !== '*' ? Number(rawCount) : null,
  }
}

const summary = {
  activeSmsCampaigns: await countRows('prospecting_campaigns', 'kind=eq.sms&status=eq.active'),
  pausedSmsCampaigns: await countRows('prospecting_campaigns', 'kind=eq.sms&status=eq.paused'),
  queuedCampaignActions: await countRows('prospecting_campaign_actions', 'status=in.(queued,processing)'),
  campaignMembers: await countRows('prospecting_campaign_members'),
  sourceProspects: await countRows('prospects'),
  sourcePhones: await countRows('prospect_phones'),
  reviewedContactTableBeforeMigration: await countRows('prospecting_campaign_member_contacts'),
}

console.log('Prospecting V1 production preflight:', JSON.stringify(summary, null, 2))

const required = [
  summary.activeSmsCampaigns,
  summary.pausedSmsCampaigns,
  summary.queuedCampaignActions,
  summary.campaignMembers,
  summary.sourceProspects,
  summary.sourcePhones,
]
if (required.some((result) => !result.reachable || result.count == null)) {
  console.error('Prospecting V1 preflight failed: a required production count was unavailable.')
  process.exit(1)
}
if (summary.activeSmsCampaigns.count > 0 || summary.pausedSmsCampaigns.count > 0 || summary.queuedCampaignActions.count > 0) {
  console.error('Prospecting V1 preflight blocked: finish or archive existing SMS campaign work before migration.')
  process.exit(1)
}

console.log('Prospecting V1 production preflight passed: no live SMS campaign work can be disrupted.')
