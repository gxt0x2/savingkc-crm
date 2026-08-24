import { supabase } from '@/lib/supabase-lazy'
import { isKnownPpcCampaignName } from '@/lib/ppc/campaigns'
import { buildUserIdentifiers, readUserIdentifiers, type GoogleAdsUserIdentifier } from '@/lib/ppc/enhanced-conversions'
import { attributionFromTrackingRows, type PpcTrackingAttributionRow } from '@/lib/ppc/tracking-attribution'

const PPC_LEAD_SOURCES = new Set(['ppc-landing', 'google_ads', 'google-ads', 'google_ads_phone', 'google_ads_tax_phone', 'paid-search'])

type LeadRow = {
  id: string
  source: string | null
  station: string | null
  phone: string | null
  email: string | null
}

type OutboxAttributionRow = {
  click_id: string | null
  click_id_type: string | null
  attribution: Record<string, unknown> | null
  payload: Record<string, unknown> | null
}

export type PpcLeadConversionContext =
  | {
    ok: true
    lead: LeadRow
    attribution: Record<string, unknown>
    userIdentifiers: GoogleAdsUserIdentifier[]
  }
  | { ok: false; reason: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function cleanRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

function attributionFromOutbox(row: OutboxAttributionRow | null | undefined): Record<string, unknown> {
  if (!row) return {}
  const attribution = row.attribution ?? {}
  const clickIdType = text(row.click_id_type)
  const clickId = text(row.click_id)
  return cleanRecord({
    ...attribution,
    ...(row.payload ?? {}),
    click_id: clickId,
    click_id_type: clickIdType,
    ...(clickIdType && clickId ? { [clickIdType]: clickId } : {}),
  })
}

function hasPpcAttribution(attribution: Record<string, unknown>): boolean {
  return (
    text(attribution.gclid) !== '' ||
    text(attribution.gbraid) !== '' ||
    text(attribution.wbraid) !== '' ||
    text(attribution.click_id) !== '' ||
    isKnownPpcCampaignName(attribution.utm_campaign) ||
    isKnownPpcCampaignName(attribution.campaign) ||
    text(attribution.traffic_source) === 'google_ads' ||
    text(attribution.channel) === 'google-ads'
  )
}

function isPpcLead(lead: LeadRow, attribution: Record<string, unknown>): boolean {
  return PPC_LEAD_SOURCES.has(text(lead.source)) || hasPpcAttribution(attribution)
}

export async function loadPpcLeadConversionContext(leadId: string): Promise<PpcLeadConversionContext> {
  const [
    { data: lead, error: leadError },
    { data: trackingRows, error: trackingError },
    { data: outboxRows, error: outboxError },
  ] = await Promise.all([
    supabase
      .from('leads')
      .select('id, source, station, phone, email')
      .eq('id', leadId)
      .maybeSingle(),
    supabase
      .from('ppc_tracking_events')
      .select('traffic_source, campaign, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, gbraid, wbraid, gad_source, gad_campaignid, gad_adgroupid, page_path, page_location, page_referrer, payload, event_time')
      .eq('lead_id', leadId)
      .order('event_time', { ascending: false })
      .limit(10),
    supabase
      .from('ppc_conversion_outbox')
      .select('click_id, click_id_type, attribution, payload')
      .eq('lead_id', leadId)
      .order('event_time', { ascending: false })
      .limit(5),
  ])

  if (leadError) return { ok: false, reason: leadError.message }
  if (trackingError) return { ok: false, reason: trackingError.message }
  if (outboxError) return { ok: false, reason: outboxError.message }
  if (!lead) return { ok: false, reason: 'lead_not_found' }

  const trackingAttribution = attributionFromTrackingRows(trackingRows as PpcTrackingAttributionRow[] | null | undefined)
  const priorOutboxRows = outboxRows as OutboxAttributionRow[] | null | undefined
  const outboxAttribution = attributionFromOutbox(priorOutboxRows?.[0])
  const priorUserIdentifiers = priorOutboxRows
    ?.map((row) => readUserIdentifiers(row.payload))
    .find((identifiers) => identifiers.length > 0) ?? []
  const leadUserIdentifiers = priorUserIdentifiers.length > 0
    ? priorUserIdentifiers
    : buildUserIdentifiers({
      email: text((lead as LeadRow).email),
      phone: text((lead as LeadRow).phone),
    })
  const attribution = cleanRecord({
    ...outboxAttribution,
    ...trackingAttribution,
    gclid: trackingAttribution.gclid || outboxAttribution.gclid,
    gbraid: trackingAttribution.gbraid || outboxAttribution.gbraid,
    wbraid: trackingAttribution.wbraid || outboxAttribution.wbraid,
    click_id: trackingAttribution.click_id || outboxAttribution.click_id,
    click_id_type: trackingAttribution.click_id_type || outboxAttribution.click_id_type,
  })

  if (!isPpcLead(lead as LeadRow, attribution)) {
    return { ok: false, reason: 'not_ppc_lead' }
  }

  return {
    ok: true,
    lead: lead as LeadRow,
    attribution,
    userIdentifiers: leadUserIdentifiers,
  }
}
