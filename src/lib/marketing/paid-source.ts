export type PaidSourceKey = 'google_ads' | 'openai_ads'

type PaidSourceInput = Record<string, unknown> | null | undefined

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number' && Number.isFinite(value)) return String(value)
  return ''
}

function lc(value: unknown): string {
  return text(value).toLowerCase()
}

function hasOpenAIAdsSignal(input: PaidSourceInput): boolean {
  if (!input) return false

  const source = lc(input.utm_source) || lc(input.source) || lc(input.traffic_source)
  const medium = lc(input.utm_medium) || lc(input.medium)
  const campaign = lc(input.utm_campaign) || lc(input.campaign)
  const referrer = lc(input.referrer) || lc(input.page_referrer)
  const landingUrl = lc(input.landingUrl) || lc(input.page_location) || lc(input.source_url)

  return Boolean(
    text(input.oppref) ||
    source === 'openai_ads' ||
    source === 'openai' ||
    source === 'chatgpt' ||
    source === 'chatgpt_ads' ||
    source.includes('openai') ||
    medium.includes('openai') ||
    campaign.includes('openai') ||
    referrer.includes('chatgpt.com') ||
    referrer.includes('openai.com') ||
    landingUrl.includes('utm_source=openai') ||
    landingUrl.includes('utm_source=chatgpt') ||
    landingUrl.includes('oppref='),
  )
}

export function paidSourceKey(input: PaidSourceInput): PaidSourceKey {
  return hasOpenAIAdsSignal(input) ? 'openai_ads' : 'google_ads'
}

export function paidSourceLabel(input: PaidSourceInput): string {
  return paidSourceKey(input) === 'openai_ads' ? 'OpenAI Ads' : 'Google Ads'
}

export function paidSourceSlug(input: PaidSourceInput): string {
  return paidSourceKey(input)
}

export function paidSourceIdentifier(input: PaidSourceInput): string {
  if (!input) return ''
  return text(input.gclid) ||
    text(input.gbraid) ||
    text(input.wbraid) ||
    text(input.click_id) ||
    text(input.oppref)
}

export function paidSourceIdentifierType(input: PaidSourceInput): string {
  if (!input) return '--'
  if (text(input.gclid)) return 'gclid'
  if (text(input.gbraid)) return 'gbraid'
  if (text(input.wbraid)) return 'wbraid'
  if (text(input.click_id_type)) return text(input.click_id_type)
  if (text(input.oppref)) return 'oppref'
  return '--'
}
