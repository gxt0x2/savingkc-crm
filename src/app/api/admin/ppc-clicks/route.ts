import { NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const PPC_LEAD_SOURCES = ['ppc-landing', 'google_ads', 'google-ads', 'google_ads_phone', 'google_ads_tax_phone', 'paid-search']

type TrackingRow = {
  id: string
  event_id: string
  event_name: string
  event_category: string
  event_time: string
  session_id: string | null
  visitor_id: string | null
  lead_id: string | null
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
  payload: Record<string, unknown> | null
}

type LeadRow = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  source: string | null
  station: string | null
  property_address: string | null
  created_at: string
}

type OutboxRow = {
  id: string
  event_name: string
  event_category: string
  event_time: string
  status: string
  approved_for_google_ads: boolean | null
  optimization_role: string | null
  lead_id: string | null
  click_id: string | null
  click_id_type: string | null
}

function chicagoDate(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

function utcRangeForChicagoDate(date: string) {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) throw new Error('date must be YYYY-MM-DD')
  const [, year, month, day] = match
  const start = new Date(`${year}-${month}-${day}T00:00:00-05:00`)
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { startIso: start.toISOString(), endIso: end.toISOString() }
}

function clickId(row: TrackingRow): string | null {
  return row.gclid || row.gbraid || row.wbraid || null
}

function clickIdType(row: TrackingRow): string | null {
  if (row.gclid) return 'gclid'
  if (row.gbraid) return 'gbraid'
  if (row.wbraid) return 'wbraid'
  return null
}

function sessionKey(row: TrackingRow): string {
  return clickId(row) || row.session_id || row.visitor_id || row.id
}

function eventCounts(rows: TrackingRow[]) {
  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.event_name] = (acc[row.event_name] || 0) + 1
    return acc
  }, {})
}

function payloadText(row: TrackingRow, key: string): string | null {
  const value = row.payload?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function payloadRecord(row: TrackingRow, key: string): Record<string, unknown> {
  const value = row.payload?.[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function sessionDeviceDetails(rows: TrackingRow[]): { label: string; ipHashPrefix: string | null } {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index]
    if (!row) continue
    const device = payloadRecord(row, 'device')
    const browser = payloadRecord(row, 'browser')
    const platform = text(device.device_platform) || text(browser.platform)
    const type = text(device.device_type)
    const mobile = device.device_mobile
    const fallbackType = mobile === true
      ? 'mobile'
      : mobile === false
        ? 'desktop'
        : Number(browser.touch_points) > 0
          ? 'touch'
          : null
    const label = [platform, type || fallbackType].filter(Boolean).join(' / ')
    const ipHash = text(device.ip_hash)
    if (label || ipHash) return { label: label || '--', ipHashPrefix: ipHash ? ipHash.slice(0, 16) : null }
  }
  return { label: '--', ipHashPrefix: null }
}

function summarizeSessions(rows: TrackingRow[], leadsById: Map<string, LeadRow>, outboxByLeadId: Map<string, OutboxRow[]>) {
  const groups = new Map<string, TrackingRow[]>()
  for (const row of rows) {
    const key = sessionKey(row)
    groups.set(key, [...(groups.get(key) ?? []), row])
  }

  return Array.from(groups.entries())
    .map(([key, group]) => {
      const ordered = group.sort((a, b) => Date.parse(a.event_time) - Date.parse(b.event_time))
      const first = ordered[0]
      const last = ordered[ordered.length - 1]
      const leadIds = Array.from(new Set(ordered.map((row) => row.lead_id).filter((id): id is string => Boolean(id))))
      const leads = leadIds.map((id) => leadsById.get(id)).filter((lead): lead is LeadRow => Boolean(lead))
      const outbox = leadIds.flatMap((id) => outboxByLeadId.get(id) ?? [])
      const device = sessionDeviceDetails(ordered)
      return {
        key,
        click_id: clickId(first),
        click_id_type: clickIdType(first),
        session_id: first.session_id,
        visitor_id: first.visitor_id,
        first_event_time: first.event_time,
        last_event_time: last.event_time,
        event_count: ordered.length,
        event_names: ordered.map((row) => row.event_name),
        landing_page: first.page_location,
        referrer: first.page_referrer,
        traffic_source: first.traffic_source,
        campaign: first.campaign,
        utm_source: first.utm_source,
        utm_medium: first.utm_medium,
        utm_campaign: first.utm_campaign,
        gad_campaignid: first.gad_campaignid,
        gad_adgroupid: first.gad_adgroupid,
        device: device.label,
        ip_hash_prefix: device.ipHashPrefix,
        max_form_step: Math.max(0, ...ordered.map((row) => row.form_step ?? 0)),
        situations: Array.from(new Set(ordered.map((row) => row.situation_raw).filter(Boolean))),
        timelines: Array.from(new Set(ordered.map((row) => row.timeline_raw).filter(Boolean))),
        conditions: Array.from(new Set(ordered.map((row) => row.condition_raw).filter(Boolean))),
        addresses_typed: Array.from(new Set(ordered.map((row) => payloadText(row, 'address')).filter(Boolean))),
        address_sources: Array.from(new Set(ordered.map((row) => payloadText(row, 'address_source')).filter(Boolean))),
        form_statuses: Array.from(new Set(ordered.map((row) => row.form_status).filter(Boolean))),
        phone_numbers: Array.from(new Set(ordered.map((row) => row.phone_number).filter(Boolean))),
        lead_ids: leadIds,
        leads: leads.map((lead) => ({
          id: lead.id,
          name: lead.full_name,
          source: lead.source,
          station: lead.station,
          address: lead.property_address,
          created_at: lead.created_at,
        })),
        outbox: outbox.map((row) => ({
          id: row.id,
          event_name: row.event_name,
          status: row.status,
          approved_for_google_ads: row.approved_for_google_ads,
          optimization_role: row.optimization_role,
          event_time: row.event_time,
        })),
      }
    })
    .sort((a, b) => Date.parse(a.first_event_time) - Date.parse(b.first_event_time))
}

export async function GET(req: Request) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const date = url.searchParams.get('date') || chicagoDate()
  const { startIso, endIso } = utcRangeForChicagoDate(date)
  const db = supabaseAdmin()

  const { data: trackingRows, error: trackingError } = await db
    .from('ppc_tracking_events')
    .select('id,event_id,event_name,event_category,event_time,session_id,visitor_id,lead_id,page_path,page_location,page_referrer,traffic_source,campaign,utm_source,utm_medium,utm_campaign,utm_term,utm_content,gclid,gbraid,wbraid,gad_source,gad_campaignid,gad_adgroupid,form_step,form_status,situation_raw,timeline_raw,condition_raw,situation_tag,timeline_urgency,condition_overall,phone_number,sms_consent,payload')
    .gte('event_time', startIso)
    .lt('event_time', endIso)
    .eq('is_test', false)
    .order('event_time', { ascending: true })
    .limit(2000)

  if (trackingError) {
    return NextResponse.json({ error: trackingError.message }, { status: 500 })
  }

  const rows = (trackingRows ?? []) as TrackingRow[]
  const leadIds = Array.from(new Set(rows.map((row) => row.lead_id).filter((id): id is string => Boolean(id))))

  const [{ data: eventLeads, error: eventLeadError }, { data: periodLeads, error: periodLeadError }, { data: outboxRows, error: outboxError }] = await Promise.all([
    leadIds.length
      ? db
        .from('leads')
        .select('id,full_name,phone,email,source,station,property_address,created_at')
        .in('id', leadIds)
      : Promise.resolve({ data: [], error: null }),
    db
      .from('leads')
      .select('id,full_name,phone,email,source,station,property_address,created_at')
      .in('source', PPC_LEAD_SOURCES)
      .gte('created_at', startIso)
      .lt('created_at', endIso)
      .order('created_at', { ascending: true }),
    db
      .from('ppc_conversion_outbox')
      .select('id,event_name,event_category,event_time,status,approved_for_google_ads,optimization_role,lead_id,click_id,click_id_type')
      .gte('event_time', startIso)
      .lt('event_time', endIso)
      .order('event_time', { ascending: true })
      .limit(1000),
  ])

  const firstError = eventLeadError || periodLeadError || outboxError
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500 })
  }

  const leads = [...((eventLeads ?? []) as LeadRow[]), ...((periodLeads ?? []) as LeadRow[])]
  const leadsById = new Map(leads.map((lead) => [lead.id, lead]))
  const outboxByLeadId = new Map<string, OutboxRow[]>()
  for (const row of (outboxRows ?? []) as OutboxRow[]) {
    if (!row.lead_id) continue
    outboxByLeadId.set(row.lead_id, [...(outboxByLeadId.get(row.lead_id) ?? []), row])
  }

  const sessions = summarizeSessions(rows, leadsById, outboxByLeadId)

  return NextResponse.json({
    date,
    timezone: 'America/Chicago',
    range: { start: startIso, end: endIso },
    totals: {
      tracking_events: rows.length,
      sessions: sessions.length,
      click_ids: new Set(rows.map(clickId).filter(Boolean)).size,
      leads_created: ((periodLeads ?? []) as LeadRow[]).length,
      outbox_events: ((outboxRows ?? []) as OutboxRow[]).length,
      event_counts: eventCounts(rows),
    },
    sessions,
    leads_created: ((periodLeads ?? []) as LeadRow[]).map((lead) => ({
      id: lead.id,
      name: lead.full_name,
      source: lead.source,
      station: lead.station,
      address: lead.property_address,
      created_at: lead.created_at,
    })),
    outbox: ((outboxRows ?? []) as OutboxRow[]).map((row) => ({
      id: row.id,
      event_name: row.event_name,
      status: row.status,
      approved_for_google_ads: row.approved_for_google_ads,
      optimization_role: row.optimization_role,
      lead_id: row.lead_id,
      click_id_type: row.click_id_type,
      event_time: row.event_time,
    })),
  })
}
