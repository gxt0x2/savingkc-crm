export type PpcCampaignKey = 'search_2026' | 'property_tax' | 'redemption' | 'excess_proceeds'

export type PpcCampaignConfig = {
  key: PpcCampaignKey
  name: string
  pagePath: '/ppc' | '/ppc-tax' | '/ppc-redemption' | '/ppc-excess-proceeds'
  pageVariant: 'ppc' | 'ppc_tax' | 'ppc_redemption' | 'ppc_excess_proceeds'
  phoneDisplay: string
  phoneTel: string
  phoneDigits: string
  phoneSource: 'google_ads_phone' | 'google_ads_tax_phone'
}

export const PPC_CAMPAIGNS = [
  {
    key: 'search_2026',
    name: 'Search 2026',
    pagePath: '/ppc',
    pageVariant: 'ppc',
    phoneDisplay: '(816) 608-8808',
    phoneTel: '+18166088808',
    phoneDigits: '8166088808',
    phoneSource: 'google_ads_phone',
  },
  {
    key: 'property_tax',
    name: 'Search - Property Tax',
    pagePath: '/ppc-tax',
    pageVariant: 'ppc_tax',
    phoneDisplay: '(816) 608-6648',
    phoneTel: '+18166086648',
    phoneDigits: '8166086648',
    phoneSource: 'google_ads_tax_phone',
  },
  {
    key: 'redemption',
    name: 'Search - Redemption',
    pagePath: '/ppc-redemption',
    pageVariant: 'ppc_redemption',
    phoneDisplay: '(816) 608-6648',
    phoneTel: '+18166086648',
    phoneDigits: '8166086648',
    phoneSource: 'google_ads_tax_phone',
  },
  {
    key: 'excess_proceeds',
    name: 'Search - Excess Proceeds',
    pagePath: '/ppc-excess-proceeds',
    pageVariant: 'ppc_excess_proceeds',
    phoneDisplay: '(816) 608-6648',
    phoneTel: '+18166086648',
    phoneDigits: '8166086648',
    phoneSource: 'google_ads_tax_phone',
  },
] as const satisfies readonly PpcCampaignConfig[]

export const DEFAULT_PPC_CAMPAIGN = PPC_CAMPAIGNS[0]

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function ppcPhoneDigits(value: unknown): string {
  const digits = text(value).replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

export function ppcCampaignForPhone(value: unknown): PpcCampaignConfig | null {
  const digits = ppcPhoneDigits(value)
  if (!digits) return null
  return PPC_CAMPAIGNS.find((campaign) => campaign.phoneDigits === digits) ?? null
}

export function isKnownPpcCampaignName(value: unknown): boolean {
  const name = text(value)
  return Boolean(name && PPC_CAMPAIGNS.some((campaign) => campaign.name === name))
}

export function ppcCampaignForPagePath(value: unknown): PpcCampaignConfig | null {
  const path = text(value).split(/[?#]/)[0] ?? ''
  if (!path) return null
  return PPC_CAMPAIGNS.find((campaign) => (
    path === campaign.pagePath || path.startsWith(`${campaign.pagePath}/`)
  )) ?? null
}

export function ppcCampaignForPageLocation(value: unknown): PpcCampaignConfig | null {
  const location = text(value)
  if (!location) return null

  try {
    return ppcCampaignForPagePath(new URL(location).pathname)
  } catch {
    return ppcCampaignForPagePath(location)
  }
}

export function ppcCampaignForAttribution(attribution: Record<string, unknown> | null | undefined): PpcCampaignConfig | null {
  if (!attribution) return null

  const campaignName = text(attribution.utm_campaign) || text(attribution.campaign)
  if (campaignName) {
    const campaign = PPC_CAMPAIGNS.find((item) => item.name === campaignName)
    if (campaign) return campaign
  }

  return ppcCampaignForPageLocation(attribution.landingUrl) || ppcCampaignForPagePath(attribution.page_path)
}

export function ppcCampaignNameForContext(input: {
  campaign?: unknown
  attribution?: Record<string, unknown> | null
  pagePath?: unknown
  pageLocation?: unknown
  fallback?: string
} = {}): string {
  return text(input.campaign) ||
    text(input.attribution?.utm_campaign) ||
    text(input.attribution?.campaign) ||
    ppcCampaignForAttribution(input.attribution)?.name ||
    ppcCampaignForPagePath(input.pagePath)?.name ||
    ppcCampaignForPageLocation(input.pageLocation)?.name ||
    input.fallback ||
    DEFAULT_PPC_CAMPAIGN.name
}

export function ppcPageVariantForPath(value: unknown): PpcCampaignConfig['pageVariant'] | undefined {
  return ppcCampaignForPagePath(value)?.pageVariant
}
