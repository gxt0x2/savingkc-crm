import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { supabase } from '@/lib/supabase-lazy'

const PPC_LEAD_SOURCES = new Set(['ppc-landing', 'google_ads', 'google-ads', 'google_ads_phone', 'google_ads_tax_phone', 'paid-search'])
const QUALIFIED_OR_BETTER_STATIONS = new Set([
  'qualified',
  'appointment',
  'appt_set',
  'appointment_set',
  'offer',
  'offer_made',
  'offer_presented',
  'negotiating',
  'negotiations',
  'contract',
  'contract_signed',
  'under_contract',
  'inspection',
  'closing_prep',
  'closing',
  'closed',
  'closed_won',
])

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

export type QueuePpcQualifiedLeadConversionResult =
  | { queued: true; reason: 'queued' }
  | { queued: false; reason: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function cleanRecord(input: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  )
}

export function isQualifiedOrBetterStation(station: string | null | undefined): boolean {
  return QUALIFIED_OR_BETTER_STATIONS.has(text(station).toLowerCase())
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
    text(attribution.utm_campaign) === 'Search 2026' ||
    text(attribution.campaign) === 'Search 2026' ||
    text(attribution.traffic_source) === 'google_ads' ||
    text(attribution.channel) === 'google-ads'
  )
}

function isPpcLead(lead: LeadRow, attribution: Record<string, unknown>): boolean {
  return PPC_LEAD_SOURCES.has(text(lead.source)) || hasPpcAttribution(attribution)
}

export async function queuePpcQualifiedLeadConversion(input: {
  leadId: string
  toStation: string | null | undefined
  fromStation?: string | null
  changedBy?: string | null
  reason?: string | null
}): Promise<QueuePpcQualifiedLeadConversionResult> {
  if (!isQualifiedOrBetterStation(input.toStation)) {
    return { queued: false, reason: 'station_not_qualified' }
  }

  const [{ data: lead, error: leadError }, { data: manifest }, { data: outboxRows }] = await Promise.all([
    supabase
      .from('leads')
      .select('id, source, station')
      .eq('id', input.leadId)
      .maybeSingle(),
    supabase
      .from('manifests')
      .select('id, manifest')
      .eq('lead_id', input.leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('ppc_conversion_outbox')
      .select('click_id, click_id_type, attribution, payload')
      .eq('lead_id', input.leadId)
      .order('event_time', { ascending: false })
      .limit(5),
  ])

  if (leadError) return { queued: false, reason: leadError.message }
  if (!lead) return { queued: false, reason: 'lead_not_found' }

  const manifestAttribution = attributionFromManifest((manifest as ManifestRow | null)?.manifest)
  const outboxAttribution = attributionFromOutbox((outboxRows as OutboxAttributionRow[] | null | undefined)?.[0])
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
    return { queued: false, reason: 'not_ppc_lead' }
  }

  const queued = await enqueuePpcConversion({
    eventName: 'qualified_lead',
    eventCategory: 'form',
    leadId: input.leadId,
    manifestId: (manifest as ManifestRow | null)?.id ?? null,
    dedupeKey: `lead:${input.leadId}:qualified_lead`,
    optimizationRole: 'primary',
    approvedForGoogleAds: true,
    conversionValue: 1,
    attribution,
    payload: {
      source: 'crm_qualified_stage',
      form_status: 'qualified_lead',
      lead_stage: input.toStation ?? null,
      previous_stage: input.fromStation ?? null,
      changed_by: input.changedBy ?? null,
      reason: input.reason ?? null,
      approval_required: false,
      google_ads_value_basis: 'factual_stage_conversion',
    },
  })

  return queued.queued
    ? { queued: true, reason: 'queued' }
    : { queued: false, reason: queued.reason }
}
