export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { paidSourceIdentifier, paidSourceIdentifierType, paidSourceLabel } from '@/lib/marketing/paid-source'
import { attributionFromTrackingRows, type PpcTrackingAttributionRow } from '@/lib/ppc/tracking-attribution'
import { supabaseAdmin } from '@/lib/supabase/admin'

const PAID_LEAD_SOURCES = new Set([
  'ppc-landing',
  'google_ads',
  'google-ads',
  'google_ads_phone',
  'google_ads_tax_phone',
  'paid-search',
  'openai_ads',
])

const EXPECTED_SIGNAL_LABELS: Record<string, string> = {
  lead_submitted: 'Form Submitted',
  qualified_lead: 'Opportunity',
  appointment_booked: 'Appointment Booked',
}

type OutboxRow = {
  id: string
  event_name: string
  status: string | null
  optimization_role: string | null
  event_time: string | null
  sent_at: string | null
  click_id: string | null
  click_id_type: string | null
  attribution: Record<string, unknown> | null
  payload: Record<string, unknown> | null
  attempts: number | null
  last_error: string | null
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function exportDestinations(payload: Record<string, unknown> | null): Array<{ destination: string; status: string; detail: string }> {
  const exportInfo = readRecord(payload?.export)
  const rows = exportInfo.destinations
  if (!Array.isArray(rows)) return []
  return rows
    .map((row) => {
      const record = readRecord(row)
      return {
        destination: text(record.destination) || 'unknown',
        status: text(record.status) || 'unknown',
        detail: text(record.detail),
      }
    })
    .filter((row) => row.destination !== 'unknown')
}

function normalizeAttribution(row: OutboxRow | null, trackingAttribution: Record<string, unknown>): Record<string, unknown> {
  const attribution = readRecord(row?.attribution)
  const payload = readRecord(row?.payload)
  return {
    ...attribution,
    ...payload,
    ...trackingAttribution,
    click_id: text(trackingAttribution.click_id) || text(row?.click_id),
    click_id_type: text(trackingAttribution.click_id_type) || text(row?.click_id_type),
  }
}

function isPaidLead(source: string | null, attribution: Record<string, unknown>, outboxRows: OutboxRow[]): boolean {
  return PAID_LEAD_SOURCES.has(text(source)) ||
    outboxRows.length > 0 ||
    Boolean(
      text(attribution.gclid) ||
      text(attribution.gbraid) ||
      text(attribution.wbraid) ||
      text(attribution.oppref) ||
      text(attribution.click_id),
    )
}

function displaySignal(eventName: string, row: OutboxRow | undefined) {
  return {
    eventName,
    label: EXPECTED_SIGNAL_LABELS[eventName] ?? eventName.replace(/_/g, ' '),
    status: row?.status ?? 'not_queued',
    optimizationRole: row?.optimization_role ?? null,
    eventTime: row?.event_time ?? null,
    sentAt: row?.sent_at ?? null,
    attempts: row?.attempts ?? 0,
    lastError: row?.last_error ?? null,
    clickIdType: row?.click_id_type ?? null,
    hasClickId: Boolean(row?.click_id),
    hasUserIdentifiers: Array.isArray(readRecord(row?.payload).user_identifiers),
    destinations: exportDestinations(row?.payload ?? null),
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()
  const [
    { data: lead, error: leadError },
    { data: trackingRows, error: trackingError },
    { data: outboxRows, error: outboxError },
  ] = await Promise.all([
    db
      .from('leads')
      .select('id, source, station')
      .eq('id', id)
      .maybeSingle(),
    db
      .from('ppc_tracking_events')
      .select('traffic_source, campaign, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, gbraid, wbraid, gad_source, gad_campaignid, gad_adgroupid, page_path, page_location, page_referrer, payload, event_time')
      .eq('lead_id', id)
      .order('event_time', { ascending: false })
      .limit(10),
    db
      .from('ppc_conversion_outbox')
      .select('id, event_name, status, optimization_role, event_time, sent_at, click_id, click_id_type, attribution, payload, attempts, last_error')
      .eq('lead_id', id)
      .order('event_time', { ascending: false })
      .limit(50),
  ])

  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
  if (trackingError) return NextResponse.json({ error: trackingError.message }, { status: 500 })
  if (outboxError) return NextResponse.json({ error: outboxError.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const trackingAttribution = attributionFromTrackingRows(
    trackingRows as PpcTrackingAttributionRow[] | null | undefined,
  )
  const rows = (outboxRows ?? []) as OutboxRow[]
  const latestRowByEvent = new Map<string, OutboxRow>()
  for (const row of rows) {
    if (!latestRowByEvent.has(row.event_name)) latestRowByEvent.set(row.event_name, row)
  }
  const attribution = normalizeAttribution(rows[0] ?? null, trackingAttribution)
  const paid = isPaidLead(lead.source, attribution, rows)

  const warnings: string[] = []
  if ((lead.station === 'appointment_set' || lead.station === 'appt_set' || lead.station === 'appointment') && !latestRowByEvent.has('appointment_booked')) {
    warnings.push('Appointment stage is set, but no appointment_booked export row exists yet.')
  }

  return NextResponse.json({
    leadId: id,
    isPaidLead: paid,
    source: lead.source,
    sourceLabel: paid ? paidSourceLabel(attribution) : null,
    campaign: text(attribution.utm_campaign) || text(attribution.campaign) || null,
    identifierType: paid ? paidSourceIdentifierType(attribution) : null,
    hasIdentifier: paid ? Boolean(paidSourceIdentifier(attribution)) : false,
    signals: Object.keys(EXPECTED_SIGNAL_LABELS).map((eventName) => displaySignal(eventName, latestRowByEvent.get(eventName))),
    warnings,
  })
}
