import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/sc/reporting
 *   ?tab=messaging|calling   (default messaging)
 *   ?from=ISO&to=ISO         (default: last 7 days)
 *   ?campaign_id=            (optional filter — restricts sc_messages)
 *   ?template_id=            (optional filter — sc_messages.workflow_id is not a
 *                             template ref, so we can only best-effort filter;
 *                             we match sc_campaigns.template_id → campaign_id)
 *   ?format=csv              (returns the metric summary as a CSV download)
 *
 * Powers the SmarterContact-parity Reporting page (Messaging + Calling tabs).
 * All aggregation is done here so the client only renders numbers + a chart.
 */

const DAY_MS = 24 * 60 * 60 * 1000

type MessagingMetrics = {
  sms_sent: number
  segments_sent: number
  delivered: number
  delivery_rate: number
  blocked: number
  carrier_block_rate: number
  replies_received: number
  reply_rate: number
  opt_outs: number
  opt_out_rate: number
  median_response_time_min: number
  contacts: number
  leads: number
  sms_to_lead_rate: number
  contact_to_lead_rate: number
}

type SeriesPoint = { date: string; sent: number; delivered: number; replies: number }

function parseRange(url: URL): { from: string; to: string } {
  const now = Date.now()
  const to = url.searchParams.get('to') || new Date(now).toISOString()
  const from =
    url.searchParams.get('from') || new Date(now - 7 * DAY_MS).toISOString()
  return { from, to }
}

/** YYYY-MM-DD key in UTC for time-series bucketing. */
function dayKey(iso: string): string {
  return iso.slice(0, 10)
}

/** Enumerate every UTC day between from..to inclusive so the chart has no gaps. */
function enumerateDays(from: string, to: string): string[] {
  const out: string[] = []
  const start = new Date(dayKey(from) + 'T00:00:00Z').getTime()
  const end = new Date(dayKey(to) + 'T00:00:00Z').getTime()
  for (let t = start; t <= end; t += DAY_MS) {
    out.push(new Date(t).toISOString().slice(0, 10))
  }
  return out
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

async function messagingReport(
  db: ReturnType<typeof supabaseAdmin>,
  from: string,
  to: string,
  campaignId: string | null,
  templateId: string | null,
): Promise<{ metrics: MessagingMetrics; series: SeriesPoint[] }> {
  // Resolve template_id → campaign_ids (sc_messages has no template ref, but
  // campaigns do). If a template filter is set we scope messages to those
  // campaigns. If both campaign + template are set, campaign wins if it
  // conflicts (campaign is the more specific filter).
  let campaignIds: string[] | null = campaignId ? [campaignId] : null
  if (templateId && !campaignId) {
    const { data: tplCampaigns } = await db
      .from('sc_campaigns')
      .select('id')
      .eq('template_id', templateId)
    campaignIds = (tplCampaigns || []).map((c) => c.id as string)
    // No campaigns use this template → nothing matches.
    if (campaignIds.length === 0) campaignIds = ['__none__']
  }

  // Fetch outbound messages in range (minimal columns for aggregation + series).
  let outQ = db
    .from('sc_messages')
    .select('segments, status, created_at')
    .eq('direction', 'outbound')
    .gte('created_at', from)
    .lte('created_at', to)
  if (campaignIds) outQ = outQ.in('campaign_id', campaignIds)
  const { data: outbound, error: outErr } = await outQ
  if (outErr) throw new Error(outErr.message)

  // Inbound (replies) in range.
  let inQ = db
    .from('sc_messages')
    .select('created_at')
    .eq('direction', 'inbound')
    .gte('created_at', from)
    .lte('created_at', to)
  if (campaignIds) inQ = inQ.in('campaign_id', campaignIds)
  const { data: inbound, error: inErr } = await inQ
  if (inErr) throw new Error(inErr.message)

  const out = outbound || []
  const inb = inbound || []

  const sms_sent = out.length
  const segments_sent = out.reduce((s, m) => s + (Number(m.segments) || 0), 0)
  const delivered = out.filter((m) => m.status === 'delivered').length
  const blocked = out.filter(
    (m) => m.status === 'failed' || m.status === 'undelivered',
  ).length
  const replies_received = inb.length

  const delivery_rate = sms_sent ? delivered / sms_sent : 0
  const carrier_block_rate = sms_sent ? blocked / sms_sent : 0

  // Conversations contacted in range: those whose first contact (created_at)
  // falls in the window. reply_rate = replied / contacted. opt_out_rate =
  // opted_out / contacted. (Approximate — a conversation created earlier but
  // messaged in-range is not counted here; we favour a simple, explainable
  // definition over exact attribution.)
  const { data: convs, error: convErr } = await db
    .from('sc_conversations')
    .select('contact_phone, has_replied, opted_out, created_at')
    .gte('created_at', from)
    .lte('created_at', to)
  if (convErr) throw new Error(convErr.message)
  const conversations = convs || []
  const contactedCount = conversations.length
  const repliedCount = conversations.filter((c) => c.has_replied).length
  const optOutCount = conversations.filter((c) => c.opted_out).length
  const reply_rate = contactedCount ? repliedCount / contactedCount : 0
  const opt_out_rate = contactedCount ? optOutCount / contactedCount : 0

  // Median response time: for each conversation, minutes between the first
  // outbound and the first inbound reply that follows it. Computed in JS over a
  // capped sample of recently-active phones to keep the query light.
  const median_response_time_min = await computeMedianResponseTime(
    db,
    from,
    to,
    campaignIds,
  )

  // Contacts / leads. contacts = distinct sc_contacts (best-effort: all rows);
  // leads = contacts that converted (lead_id not null). Conversion rates:
  //   contact_to_lead_rate = leads / contacts
  //   sms_to_lead_rate      = leads / sms_sent   (SMS effort → lead)
  const { count: contactsCount } = await db
    .from('sc_contacts')
    .select('id', { count: 'exact', head: true })
  const { count: leadsCount } = await db
    .from('sc_contacts')
    .select('id', { count: 'exact', head: true })
    .not('lead_id', 'is', null)
  const contacts = contactsCount || 0
  const leads = leadsCount || 0
  const contact_to_lead_rate = contacts ? leads / contacts : 0
  const sms_to_lead_rate = sms_sent ? leads / sms_sent : 0

  // Daily time series (sent / delivered / replies), zero-filled across range.
  const days = enumerateDays(from, to)
  const seriesMap: Record<string, SeriesPoint> = {}
  for (const d of days) seriesMap[d] = { date: d, sent: 0, delivered: 0, replies: 0 }
  for (const m of out) {
    const k = dayKey(String(m.created_at))
    if (seriesMap[k]) {
      seriesMap[k].sent += 1
      if (m.status === 'delivered') seriesMap[k].delivered += 1
    }
  }
  for (const m of inb) {
    const k = dayKey(String(m.created_at))
    if (seriesMap[k]) seriesMap[k].replies += 1
  }
  const series = days.map((d) => seriesMap[d])

  return {
    metrics: {
      sms_sent,
      segments_sent,
      delivered,
      delivery_rate,
      blocked,
      carrier_block_rate,
      replies_received,
      reply_rate,
      opt_outs: optOutCount,
      opt_out_rate,
      median_response_time_min,
      contacts,
      leads,
      sms_to_lead_rate,
      contact_to_lead_rate,
    },
    series,
  }
}

/**
 * Median minutes from first outbound to first inbound reply, per conversation.
 * Capped sample: we pull at most SAMPLE_CAP messages ordered by created_at and
 * group by contact_phone, so heavy accounts stay fast.
 */
async function computeMedianResponseTime(
  db: ReturnType<typeof supabaseAdmin>,
  from: string,
  to: string,
  campaignIds: string[] | null,
): Promise<number> {
  const SAMPLE_CAP = 5000
  let q = db
    .from('sc_messages')
    .select('contact_phone, direction, created_at')
    .gte('created_at', from)
    .lte('created_at', to)
    .order('created_at', { ascending: true })
    .limit(SAMPLE_CAP)
  if (campaignIds) q = q.in('campaign_id', campaignIds)
  const { data } = await q
  const rows = data || []

  // First outbound and first-inbound-after-outbound per phone.
  const firstOut: Record<string, number> = {}
  const responseMins: number[] = []
  const responded = new Set<string>()
  for (const r of rows) {
    const phone = r.contact_phone as string | null
    if (!phone) continue
    const ts = new Date(String(r.created_at)).getTime()
    if (r.direction === 'outbound') {
      if (!(phone in firstOut)) firstOut[phone] = ts
    } else if (r.direction === 'inbound') {
      if (phone in firstOut && !responded.has(phone) && ts >= firstOut[phone]) {
        responseMins.push((ts - firstOut[phone]) / 60000)
        responded.add(phone)
      }
    }
  }
  return Math.round(median(responseMins) * 10) / 10
}

type CallingMetrics = {
  calls_made: number
  connected: number
  connect_rate: number
  missed: number
  inbound: number
  outbound: number
  total_talk_time_min: number
  avg_call_length_min: number
  note: string | null
}

/**
 * Best-effort calling report from lead_activities (activity_type='call').
 * Metadata shape (see twilio-missed-call route): { direction, callStatus,
 * duration }. If the table/rows are unavailable we return zeros with a note.
 */
async function callingReport(
  db: ReturnType<typeof supabaseAdmin>,
  from: string,
  to: string,
): Promise<{ metrics: CallingMetrics }> {
  const empty: CallingMetrics = {
    calls_made: 0,
    connected: 0,
    connect_rate: 0,
    missed: 0,
    inbound: 0,
    outbound: 0,
    total_talk_time_min: 0,
    avg_call_length_min: 0,
    note: null,
  }

  const { data, error } = await db
    .from('lead_activities')
    .select('metadata, created_at')
    .eq('activity_type', 'call')
    .gte('created_at', from)
    .lte('created_at', to)

  if (error) {
    return {
      metrics: {
        ...empty,
        note: 'Call analytics unavailable (lead_activities query failed). Showing placeholders.',
      },
    }
  }

  const rows = data || []
  if (rows.length === 0) {
    return {
      metrics: {
        ...empty,
        note: 'No call activity recorded in this range.',
      },
    }
  }

  let calls_made = 0
  let connected = 0
  let missed = 0
  let inbound = 0
  let outbound = 0
  let totalDurationSec = 0

  const connectedStatuses = new Set(['completed', 'answered', 'in-progress'])
  const missedStatuses = new Set(['no-answer', 'busy', 'failed', 'canceled'])

  for (const r of rows) {
    const meta = (r.metadata || {}) as Record<string, unknown>
    calls_made += 1
    const dir = String(meta.direction || '').toLowerCase()
    if (dir === 'inbound') inbound += 1
    else if (dir === 'outbound') outbound += 1
    const status = String(meta.callStatus || '').toLowerCase()
    if (connectedStatuses.has(status)) connected += 1
    if (missedStatuses.has(status)) missed += 1
    const dur = Number(meta.duration)
    if (Number.isFinite(dur)) totalDurationSec += dur
  }

  const connect_rate = calls_made ? connected / calls_made : 0
  const total_talk_time_min = Math.round((totalDurationSec / 60) * 10) / 10
  const avg_call_length_min = connected
    ? Math.round((totalDurationSec / connected / 60) * 10) / 10
    : 0

  return {
    metrics: {
      calls_made,
      connected,
      connect_rate,
      missed,
      inbound,
      outbound,
      total_talk_time_min,
      avg_call_length_min,
      note: null,
    },
  }
}

/** Escape a CSV cell (quote if it contains a comma, quote, or newline). */
function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function metricsToCsv(rows: [string, unknown][]): string {
  const lines = ['Metric,Value', ...rows.map(([k, v]) => `${csvCell(k)},${csvCell(v)}`)]
  return lines.join('\n')
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`
}

export async function GET(req: Request) {
  const db = supabaseAdmin()
  const url = new URL(req.url)
  const tab = url.searchParams.get('tab') === 'calling' ? 'calling' : 'messaging'
  const { from, to } = parseRange(url)
  const campaignId = url.searchParams.get('campaign_id') || null
  const templateId = url.searchParams.get('template_id') || null
  const format = url.searchParams.get('format')

  try {
    if (tab === 'calling') {
      const { metrics } = await callingReport(db, from, to)
      if (format === 'csv') {
        const rows: [string, unknown][] = [
          ['Calls made', metrics.calls_made],
          ['Connected', metrics.connected],
          ['Connect rate', pct(metrics.connect_rate)],
          ['Missed', metrics.missed],
          ['Inbound', metrics.inbound],
          ['Outbound', metrics.outbound],
          ['Total talk time (min)', metrics.total_talk_time_min],
          ['Avg call length (min)', metrics.avg_call_length_min],
        ]
        return csvResponse('calling-report', rows)
      }
      return NextResponse.json({ tab, from, to, metrics })
    }

    const { metrics, series } = await messagingReport(
      db,
      from,
      to,
      campaignId,
      templateId,
    )

    if (format === 'csv') {
      const rows: [string, unknown][] = [
        ['SMS sent', metrics.sms_sent],
        ['SMS segments sent', metrics.segments_sent],
        ['Carrier block rate', pct(metrics.carrier_block_rate)],
        ['Replies received', metrics.replies_received],
        ['Delivery rate', pct(metrics.delivery_rate)],
        ['Opt-out rate', pct(metrics.opt_out_rate)],
        ['Reply rate', pct(metrics.reply_rate)],
        ['Median response time (min)', metrics.median_response_time_min],
        ['Leads', metrics.leads],
        ['Contacts', metrics.contacts],
        ['SMS-to-lead conversion rate', pct(metrics.sms_to_lead_rate)],
        ['Contact-to-lead conversion rate', pct(metrics.contact_to_lead_rate)],
      ]
      return csvResponse('messaging-report', rows)
    }

    return NextResponse.json({ tab, from, to, metrics, series })
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Report failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

function csvResponse(name: string, rows: [string, unknown][]) {
  const csv = metricsToCsv(rows)
  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${name}.csv"`,
    },
  })
}
