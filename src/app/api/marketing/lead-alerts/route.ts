import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { formatPhone } from '@/lib/format'
import {
  alertChannel,
  alertTriggerLabel,
  buildLeadAlertSummary,
  isLeadAlertMetadata,
  normalizeLeadAlertDelivery,
  readLeadAlertCallback,
  readLeadAlertRecipients,
  record,
  resolveLeadAlertCallback,
  text,
  type LeadAlertActivityLike,
} from '@/lib/marketing/lead-alerts'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

type LeadActivityRow = {
  id: string
  lead_id: string | null
  activity_type: string | null
  description: string | null
  metadata: Record<string, unknown> | null
  created_at: string | null
  agent: string | null
}

type LeadRow = {
  id: string
  full_name: string | null
  phone: string | null
  source: string | null
  station: string | null
  priority: string | null
  property_address: string | null
  city: string | null
  state: string | null
  classification: string | null
  opportunity_score: number | null
  created_at: string | null
}

type LeadAlertItem = {
  id: string
  leadId: string | null
  leadName: string
  leadPhoneDisplay: string | null
  leadUrl: string | null
  leadSource: string | null
  leadStation: string | null
  leadPriority: string | null
  propertyAddress: string | null
  city: string | null
  state: string | null
  classification: string | null
  opportunityScore: number | null
  trigger: string | null
  triggerLabel: string
  channel: ReturnType<typeof alertChannel>
  source: string | null
  trafficSource: string | null
  campaign: string | null
  createdAt: string
  description: string | null
  recipients: string[]
  delivery: Array<{
    target: string | null
    to: string | null
    toDisplay: string | null
    success: boolean
    sid: string | null
    error: string | null
    status: string | null
  }>
  smsSucceeded: number
  smsFailed: number
  callback: {
    started: boolean
    sid: string | null
    to: string | null
    toDisplay: string | null
    batchId: string | null
    calls: Array<{
      agentName: string | null
      to: string | null
      toDisplay: string | null
      started: boolean
      sid: string | null
      error: string | null
    }>
    error: string | null
    claimedBy: string | null
    claimedAt: string | null
    outcome: 'connected' | 'missed' | null
    outcomeAt: string | null
    dialStatus: string | null
  } | null
}

function parsePositiveInt(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.round(parsed)))
}

function phoneDisplay(value: string | null | undefined): string | null {
  const cleaned = text(value)
  if (!cleaned) return null
  return formatPhone(cleaned) || cleaned
}

function leadName(lead: LeadRow | undefined, meta: Record<string, unknown>): string {
  const from = phoneDisplay(text(meta.from) || text(meta.calledNumber))
  return text(lead?.full_name)
    || text(meta.leadName)
    || text(meta.fullName)
    || (from ? `Caller ${from}` : 'Unknown lead')
}

function relatedRowsFor(row: LeadActivityRow, callbackRows: LeadActivityRow[]): LeadAlertActivityLike[] {
  if (!row.lead_id) return []
  return callbackRows.filter((candidate) => candidate.lead_id === row.lead_id)
}

function rowToItem(
  row: LeadActivityRow,
  leadById: Map<string, LeadRow>,
  callbackRows: LeadActivityRow[],
): LeadAlertItem | null {
  if (!row.created_at) return null
  const meta = record(row.metadata)
  const lead = row.lead_id ? leadById.get(row.lead_id) : undefined
  const trigger = text(meta.trigger) || null
  const delivery = normalizeLeadAlertDelivery(meta).map((item) => ({
    ...item,
    toDisplay: phoneDisplay(item.to),
  }))
  const callbackBase = readLeadAlertCallback(meta)
  const callbackResolution = resolveLeadAlertCallback(callbackBase, relatedRowsFor(row, callbackRows))
  const callback = callbackBase
    ? {
      ...callbackBase,
      toDisplay: phoneDisplay(callbackBase.to),
      calls: callbackBase.calls.map((call) => ({
        ...call,
        toDisplay: phoneDisplay(call.to),
      })),
      ...callbackResolution,
    }
    : null

  return {
    id: row.id,
    leadId: row.lead_id,
    leadName: leadName(lead, meta),
    leadPhoneDisplay: phoneDisplay(lead?.phone),
    leadUrl: row.lead_id ? `/leads/${row.lead_id}` : null,
    leadSource: lead?.source || text(meta.source) || null,
    leadStation: lead?.station || null,
    leadPriority: lead?.priority || null,
    propertyAddress: lead?.property_address || null,
    city: lead?.city || null,
    state: lead?.state || null,
    classification: lead?.classification || null,
    opportunityScore: lead?.opportunity_score ?? null,
    trigger,
    triggerLabel: alertTriggerLabel(trigger),
    channel: alertChannel(trigger),
    source: text(meta.source) || null,
    trafficSource: text(meta.traffic_source) || null,
    campaign: text(meta.campaign) || null,
    createdAt: row.created_at,
    description: row.description,
    recipients: readLeadAlertRecipients(meta),
    delivery,
    smsSucceeded: delivery.filter((item) => item.success).length,
    smsFailed: delivery.filter((item) => !item.success).length,
    callback,
  }
}

export async function GET(req: NextRequest) {
  const email = await getCurrentUserEmail()
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: NO_STORE_HEADERS })
  }

  const params = req.nextUrl.searchParams
  const days = parsePositiveInt(params.get('days'), 14, 1, 365)
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()
  const db = supabaseAdmin()

  const { data: smsRows, error: smsError } = await db
    .from('lead_activities')
    .select('id, lead_id, activity_type, description, metadata, created_at, agent')
    .eq('activity_type', 'sms')
    .gte('created_at', since)
    .order('created_at', { ascending: false })
    .limit(2000)

  if (smsError) {
    return NextResponse.json({ error: smsError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const alertRows = ((smsRows || []) as LeadActivityRow[]).filter((row) => isLeadAlertMetadata(row.metadata))
  const leadIds = Array.from(new Set(alertRows.map((row) => row.lead_id).filter((id): id is string => Boolean(id))))

  let leadRows: LeadRow[] = []
  if (leadIds.length) {
    const { data, error } = await db
      .from('leads')
      .select('id, full_name, phone, source, station, priority, property_address, city, state, classification, opportunity_score, created_at')
      .in('id', leadIds)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    }
    leadRows = (data || []) as LeadRow[]
  }

  let callbackRows: LeadActivityRow[] = []
  if (leadIds.length) {
    const { data, error } = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, metadata, created_at, agent')
      .eq('activity_type', 'call')
      .in('lead_id', leadIds)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(4000)
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    }
    callbackRows = (data || []) as LeadActivityRow[]
  }

  const leadById = new Map(leadRows.map((lead) => [lead.id, lead]))
  const alerts = alertRows
    .map((row) => rowToItem(row, leadById, callbackRows))
    .filter((row): row is LeadAlertItem => Boolean(row))

  const summary = buildLeadAlertSummary(alerts.map((item) => ({
    recipients: item.recipients,
    delivery: item.delivery,
    callback: item.callback,
    callbackResolution: item.callback
      ? {
        claimedBy: item.callback.claimedBy,
        claimedAt: item.callback.claimedAt,
        outcome: item.callback.outcome,
        outcomeAt: item.callback.outcomeAt,
        dialStatus: item.callback.dialStatus,
      }
      : { claimedBy: null, claimedAt: null, outcome: null, outcomeAt: null, dialStatus: null },
    trigger: item.trigger,
    trafficSource: item.trafficSource,
  })))

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    filters: { days, since },
    summary,
    alerts,
  }, { headers: NO_STORE_HEADERS })
}
