import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { buildPpcReport } from '@/lib/marketing/ppc-report'
import { getPpcConversionExportConfigHealth } from '@/lib/ppc/conversion-exporter'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

const LEAD_SELECT = 'id, full_name, phone, email, source, station, priority, property_address, city, created_at, updated_at, classification, opportunity_score'

function readDays(value: string | null): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return 30
  return Math.min(Math.max(Math.round(parsed), 1), 365)
}

function isMissingTable(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return error.code === '42P01' || error.code === 'PGRST205' || /does not exist/i.test(error.message ?? '')
}

export async function GET(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const { searchParams } = new URL(req.url)
  const days = readDays(searchParams.get('days'))
  const until = new Date()
  const since = new Date(until)
  since.setDate(until.getDate() - days)

  const sinceIso = since.toISOString()
  const untilIso = until.toISOString()
  const db = supabaseAdmin()

  const [
    { data: periodLeads, error: leadError },
    { data: outbox, error: outboxError },
    { data: trackingEvents, error: trackingError },
    { data: missedCallTasks, error: missedCallTaskError },
  ] = await Promise.all([
    db
      .from('leads')
      .select(LEAD_SELECT)
      .in('source', ['ppc-landing', 'google_ads', 'google-ads', 'google_ads_phone', 'paid-search'])
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false }),
    db
      .from('ppc_conversion_outbox')
      .select('id, event_name, event_category, dedupe_key, status, approved_for_google_ads, optimization_role, lead_id, conversion_value, event_time, click_id, click_id_type, attribution, payload, attempts, last_error, sent_at, approved_at, approved_by, approval_note, created_at')
      .gte('event_time', sinceIso)
      .order('event_time', { ascending: false })
      .limit(2000),
    db
      .from('ppc_tracking_events')
      .select('id, event_id, event_name, event_category, event_time, session_id, visitor_id, lead_id, page_location, page_referrer, traffic_source, campaign, utm_source, utm_medium, utm_campaign, utm_term, utm_content, gclid, gbraid, wbraid, gad_source, gad_campaignid, gad_adgroupid, form_step, form_status, situation_raw, timeline_raw, condition_raw, phone_number, sms_consent, is_test, payload, created_at')
      .gte('event_time', sinceIso)
      .order('event_time', { ascending: false })
      .limit(5000),
    db
      .from('lead_activities')
      .select('id, lead_id, created_at, metadata')
      .eq('activity_type', 'task')
      .eq('metadata->>task_type', 'google_ads_missed_call_escalation')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .limit(500),
  ])

  if (leadError) {
    return NextResponse.json({ error: leadError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  if (outboxError && !isMissingTable(outboxError)) {
    return NextResponse.json({ error: outboxError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }
  if (trackingError && !isMissingTable(trackingError)) {
    return NextResponse.json({ error: trackingError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }
  if (missedCallTaskError && !isMissingTable(missedCallTaskError)) {
    return NextResponse.json({ error: missedCallTaskError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const outboxRows = outboxError ? [] : outbox ?? []
  const trackingRows = trackingError ? [] : trackingEvents ?? []
  const missedCallTaskRows = missedCallTaskError ? [] : missedCallTasks ?? []
  const periodLeadRows = periodLeads ?? []
  const periodLeadIds = new Set(periodLeadRows.map((lead) => lead.id))
  const missingOutboxLeadIds = Array.from(
    new Set(
      outboxRows
        .map((row) => row.lead_id)
        .filter((id): id is string => Boolean(id && !periodLeadIds.has(id))),
    ),
  )

  const { data: outboxLeads, error: outboxLeadError } = missingOutboxLeadIds.length > 0
    ? await db
      .from('leads')
      .select(LEAD_SELECT)
      .in('id', missingOutboxLeadIds)
    : { data: [], error: null }

  if (outboxLeadError) {
    return NextResponse.json({ error: outboxLeadError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const leads = [...periodLeadRows, ...(outboxLeads ?? [])]
  const leadIds = leads.map((lead) => lead.id)

  const [
    { data: activities, error: activityError },
    { data: manifests, error: manifestError },
    { data: appointments, error: appointmentError },
    { data: revenue, error: revenueError },
  ] = leadIds.length > 0
    ? await Promise.all([
      db
        .from('lead_activities')
        .select('id, lead_id, activity_type, description, metadata, created_at, agent')
        .in('lead_id', leadIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: true })
        .limit(5000),
      db
        .from('manifests')
        .select('lead_id, manifest, created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false }),
      db
        .from('appointments')
        .select('id, lead_id, scheduled_at, status, source, created_at')
        .in('lead_id', leadIds)
        .gte('created_at', sinceIso)
        .order('created_at', { ascending: false }),
      db
        .from('revenue_transactions')
        .select('id, deal_id, amount, date, source')
        .in('deal_id', leadIds)
        .gte('date', sinceIso.slice(0, 10))
        .order('date', { ascending: false }),
    ])
    : [
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
      { data: [], error: null },
    ]

  const firstError = activityError || manifestError || appointmentError || revenueError
  if (firstError) {
    return NextResponse.json({ error: firstError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const report = buildPpcReport({
    days,
    since: sinceIso,
    until: untilIso,
    leads,
    activities: activities ?? [],
    outbox: outboxRows,
    trackingEvents: trackingRows,
    appointments: appointments ?? [],
    revenue: revenue ?? [],
    manifests: manifests ?? [],
    missedCallTasks: missedCallTaskRows,
    exportConfig: getPpcConversionExportConfigHealth(process.env),
  })

  return NextResponse.json(report, { headers: NO_STORE_HEADERS })
}
