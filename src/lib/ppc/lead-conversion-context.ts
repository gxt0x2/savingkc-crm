import { supabase } from '@/lib/supabase-lazy'
import { isKnownPpcCampaignName } from '@/lib/ppc/campaigns'
import { readUserIdentifiers, type GoogleAdsUserIdentifier } from '@/lib/ppc/enhanced-conversions'

const PPC_LEAD_SOURCES = new Set(['ppc-landing', 'google_ads', 'google-ads', 'google_ads_phone', 'google_ads_tax_phone', 'paid-search'])

type LeadRow = {
  id: string
  source: string | null
  station: string | null
}

type ManifestRow = {
  id: string | null
  manifest: Record<string, unknown> | null
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
    manifestId: string | null
    attribution: Record<string, unknown>
    userIdentifiers: GoogleAdsUserIdentifier[]
  }
  | { ok: false; reason: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function cleanRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

function attributionFromManifest(manifest: Record<string, unknown> | null | undefined): Record<string, unknown> {
  const acquisition = record(manifest?.acquisition)
  return cleanRecord({
    ...record(acquisition.attribution),
    source: acquisition.source,
    channel: acquisition.channel,
  })
}

function attributionFromOutbox(row: OutboxAttributionRow | null | undefined): Record<string, unknown> {
  if (!row) return {}
  const attribution = record(row.attribution)
  const clickIdType = text(row.click_id_type)
  const clickId = text(row.click_id)
  return cleanRecord({
    ...attribution,
    ...record(row.payload),
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
  const [{ data: lead, error: leadError }, { data: manifest }, { data: outboxRows }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, source, station')
      .eq('id', leadId)
      .maybeSingle(),
    supabase
      .from('manifests')
      .select('id, manifest')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ppc_conversion_outbox')
      .select('click_id, click_id_type, attribution, payload')
      .eq('lead_id', leadId)
      .order('event_time', { ascending: false })
      .limit(5),
  ])

  if (leadError) return { ok: false, reason: leadError.message }
  if (!lead) return { ok: false, reason: 'lead_not_found' }

  const manifestAttribution = attributionFromManifest((manifest as ManifestRow | null)?.manifest)
  const priorOutboxRows = outboxRows as OutboxAttributionRow[] | null | undefined
  const outboxAttribution = attributionFromOutbox(priorOutboxRows?.[0])
  const priorUserIdentifiers = priorOutboxRows
    ?.map((row) => readUserIdentifiers(row.payload))
    .find((identifiers) => identifiers.length > 0) ?? []
  const attribution = cleanRecord({
    ...outboxAttribution,
    ...manifestAttribution,
    gclid: manifestAttribution.gclid || outboxAttribution.gclid,
    gbraid: manifestAttribution.gbraid || outboxAttribution.gbraid,
    wbraid: manifestAttribution.wbraid || outboxAttribution.wbraid,
    click_id: manifestAttribution.click_id || outboxAttribution.click_id,
    click_id_type: manifestAttribution.click_id_type || outboxAttribution.click_id_type,
  })

  if (!isPpcLead(lead as LeadRow, attribution)) {
    return { ok: false, reason: 'not_ppc_lead' }
  }

  return {
    ok: true,
    lead: lead as LeadRow,
    manifestId: (manifest as ManifestRow | null)?.id ?? null,
    attribution,
    userIdentifiers: priorUserIdentifiers,
  }
}
