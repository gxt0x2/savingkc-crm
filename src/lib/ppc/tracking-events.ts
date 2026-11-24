import { supabase } from '@/lib/supabase-lazy'
import { cleanJsonRecord } from '@/lib/ppc/conversion-outbox'
import { DEFAULT_PPC_CAMPAIGN, ppcCampaignNameForContext } from '@/lib/ppc/campaigns'
import { paidSourceSlug } from '@/lib/marketing/paid-source'

export const SITUATION_TO_TAG = {
  'tax-delinquent': 'tax_delinquent',
  inherited: 'inherited',
  'tired-landlord': 'tired_landlord',
  condition: 'distressed_condition',
  'life-event': 'life_event',
  'redemption-window': 'tax_sale_redemption',
  'redemption-not-sure': 'redemption_help_needed',
  'excess-proceeds': 'excess_proceeds',
  'excess-not-sure': 'excess_proceeds_check',
  other: 'ppc_other',
} as const

export const TIMELINE_TO_URGENCY = {
  asap: 'critical',
  '60-days': 'high',
  flexible: 'medium',
  exploring: 'low',
} as const

export const CONDITION_TO_OVERALL = {
  good: 'good',
  'needs-work': 'fair',
  'major-repair': 'poor',
  vacant: 'poor',
  'redeem-payoff': null,
  'redeem-title': null,
  'redeem-cash': null,
  'redeem-sell': null,
  'proceeds-claim': null,
  'proceeds-heirs': null,
  'proceeds-liens': null,
  'proceeds-cash-now': null,
} as const

export type PpcTrackingEventCategory = 'visit' | 'form' | 'phone' | 'call' | 'conversion' | 'error' | 'web'

export type PpcTrackingAttribution = {
  utm_source?: string
  utm_medium?: string
  utm_campaign?: string
  utm_term?: string
  utm_content?: string
  keyword?: string
  matchtype?: string
  campaignid?: string
  adgroupid?: string
  gclid?: string
  gbraid?: string
  wbraid?: string
  msclkid?: string
  oppref?: string
  gad_source?: string
  gad_campaignid?: string
  gad_adgroupid?: string
  skc_openai_click_id?: string
  referrer?: string
  landingUrl?: string
}

export type RecordPpcTrackingEventInput = {
  eventId: string
  eventName: string
  eventCategory?: PpcTrackingEventCategory
  eventTime?: string | Date
  sessionId?: string | null
  visitorId?: string | null
  leadId?: string | null
  manifestId?: string | null
  activityId?: string | null
  pagePath?: string | null
  pageLocation?: string | null
  pageReferrer?: string | null
  trafficSource?: string | null
  campaign?: string | null
  formStep?: number | null
  formStatus?: string | null
  situation?: string | null
  timeline?: string | null
  condition?: string | null
  phoneNumber?: string | null
  smsConsent?: boolean | null
  isTest?: boolean
  /** Website journey flag. `true` or `"true"` stores the row as a test event. */
  is_test?: boolean | string | number
  attribution?: PpcTrackingAttribution | null
  payload?: Record<string, unknown> | null
}

export type PpcTrackingEventRow = {
  event_id: string
  event_name: string
  event_category: PpcTrackingEventCategory
  event_time: string
  session_id: string | null
  visitor_id: string | null
  lead_id: string | null
  manifest_id: string | null
  activity_id: string | null
  page_path: string | null
  page_location: string | null
  page_referrer: string | null
  traffic_source: string | null
  campaign: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_term: string | null
  utm_content: string | null
  gclid: string | null
  gbraid: string | null
  wbraid: string | null
  gad_source: string | null
  gad_campaignid: string | null
  gad_adgroupid: string | null
  form_step: number | null
  form_status: string | null
  situation_raw: string | null
  timeline_raw: string | null
  condition_raw: string | null
  situation_tag: string | null
  timeline_urgency: string | null
  condition_overall: string | null
  phone_number: string | null
  sms_consent: boolean | null
  is_test: boolean
  payload: Record<string, unknown>
}

type TrackingEventTable = {
  upsert: (
    row: PpcTrackingEventRow,
    options: { onConflict: string; ignoreDuplicates: boolean },
  ) => PromiseLike<{ error: { code?: string; message?: string } | null }>
}

type TrackingEventClient = {
  from: (table: string) => TrackingEventTable
}

/** Traffic sources the paid dashboards (Ads Command, PPC report, clicks) read. */
export const PAID_TRAFFIC_SOURCES = ['google_ads', 'openai_ads', 'google'] as const

/** Sources the sitewide journey (savingkc.com/skc-journey.js) sends. */
export const SITE_TRAFFIC_SOURCES = [
  'google_ads', 'openai_ads', 'paid_other', 'ai_referral', 'organic_search', 'social', 'email', 'referral', 'direct',
] as const
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid', 'paidsearch', 'paid_search', 'sem'])
/** Evidence that may store a paid campaign name. Traffic classification uses the wider PAID_MEDIUMS set. */
const EVENT_PAID_CLICK_KEYS = ['gclid', 'gbraid', 'wbraid', 'msclkid'] as const
const EVENT_PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid'])
const AI_REFERRER = /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|bard\.google\.com|copilot\.microsoft\.com)$/
const SEARCH_REFERRER = /(^|\.)(google|bing|yahoo|duckduckgo|ecosia|search\.brave)\.[a-z.]+$/
const SOCIAL_REFERRER = /(^|\.)(facebook|instagram|youtube|tiktok|linkedin|x|twitter|nextdoor|reddit)\.com$|(^|\.)t\.co$/

function hostOf(url: string | null): string {
  if (!url) return ''
  try { return new URL(url).hostname.toLowerCase() } catch { return '' }
}

/**
 * Traffic source for a tracking row. Explicit paid sources and the site
 * journey's own classification are kept. Everything else used to fall back to
 * paidSourceSlug(), which only knows google_ads/openai_ads — so an organic or
 * ChatGPT visitor would have been logged as Google Ads. Paid is now only
 * claimed with paid evidence (click id, paid medium, /ppc* lander).
 */
export function classifyTrafficSource(input: {
  trafficSource?: string | null
  attribution: PpcTrackingAttribution
  pagePath?: string | null
  pageLocation?: string | null
  pageReferrer?: string | null
}): string {
  const given = text(input.trafficSource)?.toLowerCase() ?? null
  // Explicit labels win (middleware, lead/book routes, site journey); bare non_paid gets refined.
  if (given && given !== 'non_paid') return given
  const a = input.attribution
  const medium = (text(a.utm_medium) ?? '').toLowerCase()
  const source = (text(a.utm_source) ?? '').toLowerCase()
  const path = text(input.pagePath) ?? ''
  const paidLander = path === '/ppc' || path.startsWith('/ppc-') || path.startsWith('/ppc/') || path.startsWith('/ppc?')
  if (text(a.oppref) || text(a.skc_openai_click_id)) return 'openai_ads'
  if (text(a.gclid) || text(a.gbraid) || text(a.wbraid)) return 'google_ads'
  if (PAID_MEDIUMS.has(medium)) return /openai|chatgpt/.test(source) ? 'openai_ads' : /google|adwords/.test(source) ? 'google_ads' : 'paid_other'
  if (!given && paidLander) {
    return paidSourceSlug({ ...a, page_location: input.pageLocation, page_referrer: input.pageReferrer, source_url: input.pageLocation })
  }
  const referrerHost = hostOf(text(input.pageReferrer) ?? text(a.referrer) ?? null)
  if (AI_REFERRER.test(referrerHost) || /^(chatgpt|openai|perplexity|claude|gemini|copilot)/.test(source)) return 'ai_referral'
  if (medium === 'email' || source === 'email') return 'email'
  if (!referrerHost || referrerHost.endsWith('savingkc.com')) return given === 'non_paid' ? 'direct' : source ? 'referral' : 'direct'
  if (SEARCH_REFERRER.test(referrerHost)) return 'organic_search'
  if (SOCIAL_REFERRER.test(referrerHost)) return 'social'
  return 'referral'
}

function iso(value: string | Date | undefined): string {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string' && value.trim()) return value
  return new Date().toISOString()
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function bool(value: boolean | null | undefined): boolean | null {
  return typeof value === 'boolean' ? value : null
}

function hasTestMarker(...values: Array<unknown>): boolean {
  return values.some((value) => typeof value === 'string' && /(^|[^a-z0-9])(codex|test|dummy|probe|smoke)([^a-z0-9]|$)/i.test(value))
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function flagTrue(value: unknown): boolean {
  return value === true || value === 'true' || value === 1 || value === '1'
}

/** Click id or paid medium on any of the supplied attribution records. */
export function hasPaidCampaignEvidence(...sources: Array<Record<string, unknown> | null | undefined>): boolean {
  for (const source of sources) {
    if (!source) continue
    if (EVENT_PAID_CLICK_KEYS.some((key) => text(source[key]))) return true
    const medium = (text(source.utm_medium) ?? '').toLowerCase()
    if (EVENT_PAID_MEDIUMS.has(medium)) return true
  }
  return false
}

function campaignEvidenceSources(input: {
  attribution?: Record<string, unknown> | null
  payload?: Record<string, unknown> | null
}): Array<Record<string, unknown> | null> {
  const payload = input.payload ?? null
  return [input.attribution ?? null, payload, asRecord(payload?.attribution)]
}

/**
 * Campaign stored on a first-party event row.
 * utm_campaign wins. Otherwise the paid campaign name (page match, explicit
 * name, or the Search 2026 default inside ppcCampaignNameForContext) is stored
 * only when a click id or paid medium is present. Direct traffic stays null.
 * The conversion outbox still calls ppcCampaignNameForContext directly.
 */
export function storedFirstPartyEventCampaign(input: {
  campaign?: unknown
  attribution?: Record<string, unknown> | null
  pagePath?: unknown
  pageLocation?: unknown
  payload?: Record<string, unknown> | null
}): string | null {
  const sources = campaignEvidenceSources(input)
  const utmCampaign = sources.map((source) => text(source?.utm_campaign)).find((value) => value)
  if (utmCampaign) return utmCampaign
  if (!hasPaidCampaignEvidence(...sources)) return null
  return ppcCampaignNameForContext({
    campaign: input.campaign,
    attribution: input.attribution,
    pagePath: input.pagePath,
    pageLocation: input.pageLocation,
  })
}

/**
 * Historical rows written before the campaign default was removed. Read-only:
 * true when the stored campaign is the old Search 2026 fill-in and the row
 * still has no utm_campaign or paid click/medium evidence.
 */
export function unprovenStoredSearchCampaign(row: Record<string, unknown>): boolean {
  if (text(row.campaign) !== DEFAULT_PPC_CAMPAIGN.name) return false
  const payload = asRecord(row.payload)
  const sources = [row, payload, asRecord(payload?.attribution)]
  if (sources.some((source) => text(source?.utm_campaign))) return false
  return !hasPaidCampaignEvidence(...sources)
}

export function unprovenSearch2026CampaignNote(rows: Array<Record<string, unknown>>): { unprovenSearch2026: number; note: string } {
  const unprovenSearch2026 = rows.filter(unprovenStoredSearchCampaign).length
  const note = unprovenSearch2026 === 0
    ? 'Stored campaign is utm_campaign when present, otherwise the paid campaign name only with a click id (gclid, gbraid, wbraid, msclkid) or paid medium (cpc, ppc, paid). This window has no Search 2026 rows without that evidence.'
    : `${unprovenSearch2026} events in this window still store campaign "Search 2026" with no utm_campaign, gclid, gbraid, wbraid, or cpc/ppc/paid medium on the row. This read does not change them. A click id kept only in the payload is not part of this count. scripts/backfill-unproven-search-2026-campaigns.mts checks the payload too and can set those campaigns to null; it is a dry run unless --write is passed.`
  return { unprovenSearch2026, note }
}

function websiteMarkedTest(input: RecordPpcTrackingEventInput): boolean {
  const payload = input.payload ?? {}
  return flagTrue(input.isTest) || flagTrue(input.is_test) || flagTrue(payload.is_test) || flagTrue(payload.isTest)
}

function categoryFor(eventName: string, fallback?: PpcTrackingEventCategory): PpcTrackingEventCategory {
  if (fallback) return fallback
  if (eventName === 'ppc_visit_started' || eventName === 'page_view') return 'visit'
  if (eventName === 'phone_click' || eventName === 'skc_phone_number_selected') return 'phone'
  if (eventName === 'form_error') return 'error'
  if (eventName.startsWith('lead_') || eventName === 'appointment_booked') return 'conversion'
  if (eventName === 'contact_field_started') return 'form'
  if (eventName === 'address_typed' || eventName === 'ppc_potential_lead_created') return 'form'
  if (eventName.includes('form') || eventName.includes('step') || eventName.endsWith('_selected')) return 'form'
  return 'web'
}

export function buildPpcTrackingEventRow(input: RecordPpcTrackingEventInput): PpcTrackingEventRow {
  const attribution = input.attribution ?? {}
  const situation = text(input.situation)
  const timeline = text(input.timeline)
  const condition = text(input.condition)
  const gclid = text(attribution.gclid)
  const gbraid = text(attribution.gbraid)
  const wbraid = text(attribution.wbraid)
  const skcOpenAIClickId = text(attribution.skc_openai_click_id)
  const pageLocation = text(input.pageLocation) || text(attribution.landingUrl)
  const pageReferrer = text(input.pageReferrer) || text(attribution.referrer)
  const trafficSource = classifyTrafficSource({
    trafficSource: input.trafficSource,
    attribution,
    pagePath: input.pagePath,
    pageLocation,
    pageReferrer,
  })
  const payload = cleanJsonRecord({
    ...(input.payload ?? {}),
    attribution,
  })

  return {
    event_id: input.eventId,
    event_name: input.eventName,
    event_category: categoryFor(input.eventName, input.eventCategory),
    event_time: iso(input.eventTime),
    session_id: text(input.sessionId),
    visitor_id: text(input.visitorId),
    lead_id: text(input.leadId),
    manifest_id: text(input.manifestId),
    activity_id: text(input.activityId),
    page_path: text(input.pagePath),
    page_location: pageLocation,
    page_referrer: pageReferrer,
    traffic_source: trafficSource,
    campaign: storedFirstPartyEventCampaign({
      campaign: input.campaign,
      attribution,
      pagePath: input.pagePath,
      pageLocation,
      payload: input.payload,
    }),
    utm_source: text(attribution.utm_source),
    utm_medium: text(attribution.utm_medium),
    utm_campaign: text(attribution.utm_campaign),
    utm_term: text(attribution.utm_term),
    utm_content: text(attribution.utm_content),
    gclid,
    gbraid,
    wbraid,
    gad_source: text(attribution.gad_source),
    gad_campaignid: text(attribution.gad_campaignid),
    gad_adgroupid: text(attribution.gad_adgroupid),
    form_step: typeof input.formStep === 'number' ? input.formStep : null,
    form_status: text(input.formStatus),
    situation_raw: situation,
    timeline_raw: timeline,
    condition_raw: condition,
    situation_tag: situation && situation in SITUATION_TO_TAG ? SITUATION_TO_TAG[situation as keyof typeof SITUATION_TO_TAG] : null,
    timeline_urgency: timeline && timeline in TIMELINE_TO_URGENCY ? TIMELINE_TO_URGENCY[timeline as keyof typeof TIMELINE_TO_URGENCY] : null,
    condition_overall: condition && condition in CONDITION_TO_OVERALL ? CONDITION_TO_OVERALL[condition as keyof typeof CONDITION_TO_OVERALL] : null,
    phone_number: text(input.phoneNumber),
    sms_consent: bool(input.smsConsent),
    is_test: websiteMarkedTest(input) || hasTestMarker(input.eventId, gclid, gbraid, wbraid, skcOpenAIClickId, input.sessionId, input.visitorId),
    payload,
  }
}

export async function recordPpcTrackingEvent(
  input: RecordPpcTrackingEventInput,
  client: TrackingEventClient = supabase as unknown as TrackingEventClient,
): Promise<{ recorded: true; row: PpcTrackingEventRow } | { recorded: false; row: PpcTrackingEventRow; reason: string }> {
  const row = buildPpcTrackingEventRow(input)

  try {
    const { error } = await client.from('ppc_tracking_events').upsert(row, {
      onConflict: 'event_id',
      ignoreDuplicates: true,
    })

    if (!error) return { recorded: true, row }

    const reason = error.message ?? error.code ?? 'Unknown tracking event error'
    if (error.code === '42P01' || error.code === 'PGRST205') {
      console.error('[ppc/tracking-events] table missing; migration has not been applied yet', reason)
    } else {
      console.error('[ppc/tracking-events] insert failed', error)
    }
    return { recorded: false, row, reason }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error('[ppc/tracking-events] insert threw', error)
    return { recorded: false, row, reason }
  }
}
