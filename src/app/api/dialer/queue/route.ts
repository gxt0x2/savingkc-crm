export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import { isWithinDialerCallingHours, phoneLookupVariants } from '@/lib/dialer-call-policy'
import {
  buildDialerQueueContext,
  type DialerQueueContactRow,
  type DialerQueueFollowupRow,
} from '@/lib/server/dialer-queue-context'

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

const LEAD_SELECT = [
  'id',
  'full_name',
  'phone',
  'email',
  'property_address',
  'city',
  'state',
  'zip',
  'county',
  'is_favorite',
  'source',
  'station',
  'classification',
  'priority',
  'seller_situation',
  'motivation_score',
  'appointment_date',
  'created_at',
  'updated_at',
].join(', ')

const FOLLOWUP_TYPES = ['task', 'appointment', 'follow_up', 'callback', 'send_offer']
const CONTACT_TYPES = ['call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound']
const PROSPECT_SELECT = 'lead_id, delinquent_years_category, is_deceased'
const EXPANDED_PROSPECT_SELECT = 'id, lead_id, owner_1, cumulative_due, earliest_delinquent_year, delinquent_years_category, total_market_value, zestimate, situs_street, situs_city, situs_state, situs_zip, mailing_street, mailing_city, mailing_state, mailing_zip, county, is_deceased'

interface DialerQueueLeadRow {
  id: string
  phone: string | null
  station: string | null
  classification: string | null
  [key: string]: unknown
}

async function activeSuppressedPhones(): Promise<Set<string>> {
  const blocked = new Set<string>()
  const pageSize = 1000
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from('sms_opt_outs')
      .select('phone')
      .eq('is_opted_out', true)
      .order('phone', { ascending: true })
      .range(offset, offset + pageSize - 1)
    if (error) throw new Error(error.message)
    const rows = data ?? []
    for (const row of rows) {
      const normalized = phoneLookupVariants((row as { phone?: string | null }).phone).find((value) => value.startsWith('+1'))
      if (normalized) blocked.add(normalized)
    }
    if (rows.length < pageSize) break
  }
  return blocked
}

function successHeaders(
  startedAt: number,
  timings: { leads: number; suppression: number; context: number },
  counts: { leads: number; context: number; prospects: number },
): HeadersInit {
  return {
    ...NO_STORE_HEADERS,
    'Server-Timing': [
      `leads;dur=${timings.leads.toFixed(1)}`,
      `suppression;dur=${timings.suppression.toFixed(1)}`,
      `context;dur=${timings.context.toFixed(1)}`,
      `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
    ].join(', '),
    'X-CRM-Row-Counts': `leads=${counts.leads},context=${counts.context},prospects=${counts.prospects}`,
  }
}

function isTerminalLead(lead: DialerQueueLeadRow): boolean {
  return ['dead', 'closed_lost'].includes(lead.station?.toLowerCase() ?? '')
    || lead.classification?.toLowerCase() === 'dead'
}

export function filterDialerQueueLeads(
  leads: DialerQueueLeadRow[],
  suppressedPhones: ReadonlySet<string>,
): DialerQueueLeadRow[] {
  return leads.filter((lead) => {
    if (isTerminalLead(lead)) return false
    const normalized = phoneLookupVariants(lead.phone).find((value) => value.startsWith('+1'))
    return Boolean(normalized && !suppressedPhones.has(normalized))
  })
}

function parseLeadIds(value: string | null): string[] {
  if (!value) return []
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  )).slice(0, 1000)
}

async function resolveCohortLeadIds(cohort: string | null): Promise<string[]> {
  if (cohort !== 'deceased-2-3yr') return []

  const { data, error } = await supabase
    .from('prospects')
    .select('lead_id')
    .eq('is_deceased', true)
    .in('delinquent_years_category', ['2yr', '3yr_plus'])
    .not('lead_id', 'is', null)
    .limit(2000)

  if (error) throw new Error(error.message)

  return Array.from(new Set(
    (data || [])
      .map((row: { lead_id: string | null }) => row.lead_id)
      .filter((id: string | null): id is string => Boolean(id))
  ))
}

export async function GET(req: NextRequest) {
  const requestStartedAt = performance.now()
  try {
    const { searchParams } = new URL(req.url)
    const explicitLeadIds = parseLeadIds(searchParams.get('lead_ids'))
    const cohortLeadIds = explicitLeadIds.length > 0
      ? []
      : await resolveCohortLeadIds(searchParams.get('cohort'))
    const requestedLeadIds = explicitLeadIds.length > 0 ? explicitLeadIds : cohortLeadIds
    const idsOnly = searchParams.get('ids_only') === '1'
    const limitParam = Number(searchParams.get('limit') || '1000')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 2000) : 1000

    if (idsOnly) {
      return NextResponse.json({ success: true, leadIds: requestedLeadIds }, { headers: NO_STORE_HEADERS })
    }

    const leadsStartedAt = performance.now()
    const leadQuery = supabase
      .from('leads')
      .select(LEAD_SELECT)
      .not('phone', 'is', null)
      .or('station.is.null,station.not.in.(dead,closed_lost)')
      .or('classification.is.null,classification.neq.dead')
      .order('updated_at', { ascending: false })
      .limit(requestedLeadIds.length > 0 ? Math.max(requestedLeadIds.length, 1) : limit)

    const { data: leadRows, error: leadError } = requestedLeadIds.length > 0
      ? await leadQuery.in('id', requestedLeadIds)
      : await leadQuery

    if (leadError) {
      return NextResponse.json({ success: false, error: leadError.message }, { status: 500, headers: NO_STORE_HEADERS })
    }
    const leadsDuration = performance.now() - leadsStartedAt

    const rawLeadRows = (leadRows || []) as unknown as DialerQueueLeadRow[]
    const suppressionStartedAt = performance.now()
    const suppressedPhones = await activeSuppressedPhones()
    const suppressionDuration = performance.now() - suppressionStartedAt
    const normalizedLeadRows = filterDialerQueueLeads(rawLeadRows, suppressedPhones)
    const leadIds = Array.from(new Set(
      normalizedLeadRows
        .map((row) => row.id)
        .filter(Boolean)
    ))

    if (leadIds.length === 0) {
      return NextResponse.json(
        {
          success: true,
          leads: [],
          queueContext: [],
          queueMetrics: { callsToday: 0, uniqueLeadsToday: 0 },
          prospects: [],
          queuePolicy: { callingWindowOpen: isWithinDialerCallingHours() },
        },
        {
          headers: successHeaders(requestStartedAt, {
            leads: leadsDuration,
            suppression: suppressionDuration,
            context: 0,
          }, { leads: 0, context: 0, prospects: 0 }),
        },
      )
    }

    const contextStartedAt = performance.now()
    if (requestedLeadIds.length > 0) {
      const { data: prospects, error: prospectError } = await supabase
        .from('prospects')
        .select(EXPANDED_PROSPECT_SELECT)
        .in('lead_id', leadIds)
        .limit(Math.min(Math.max(leadIds.length * 5, 100), 2000))

      if (prospectError) {
        return NextResponse.json({ success: false, error: prospectError.message }, { status: 500, headers: NO_STORE_HEADERS })
      }

      return NextResponse.json(
        {
          success: true,
          leads: normalizedLeadRows,
          queueContext: [],
          queueMetrics: { callsToday: 0, uniqueLeadsToday: 0 },
          prospects: prospects || [],
          queuePolicy: { callingWindowOpen: isWithinDialerCallingHours() },
        },
        {
          headers: successHeaders(requestStartedAt, {
            leads: leadsDuration,
            suppression: suppressionDuration,
            context: performance.now() - contextStartedAt,
          }, { leads: normalizedLeadRows.length, context: 0, prospects: prospects?.length ?? 0 }),
        },
      )
    }

    const followupQuery = supabase
      .from('lead_activities')
      .select('lead_id, activity_type, metadata, created_at')
      .in('lead_id', leadIds)
      .in('activity_type', FOLLOWUP_TYPES)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(leadIds.length * 20, 100), 2000))

    const contactQuery = supabase
      .from('lead_activities')
      .select('lead_id, activity_type, created_at')
      .in('lead_id', leadIds)
      .in('activity_type', CONTACT_TYPES)
      .order('created_at', { ascending: false })
      .limit(Math.min(Math.max(leadIds.length * 100, 200), 5000))

    const prospectQuery = supabase
      .from('prospects')
      .select(PROSPECT_SELECT)
      .in('lead_id', leadIds)
      .limit(Math.min(Math.max(leadIds.length * 10, 100), 2000))

    const [
      { data: followups, error: followupError },
      { data: contactActivities, error: contactError },
      { data: prospects, error: prospectError },
    ] = await Promise.all([
      followupQuery,
      contactQuery,
      prospectQuery,
    ])

    const error = followupError || contactError || prospectError
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    }
    const { context, metrics } = buildDialerQueueContext(
      leadIds,
      (followups || []) as DialerQueueFollowupRow[],
      (contactActivities || []) as DialerQueueContactRow[],
    )
    const contextDuration = performance.now() - contextStartedAt

    return NextResponse.json(
      {
        success: true,
        leads: normalizedLeadRows,
        queueContext: context,
        queueMetrics: metrics,
        prospects: prospects || [],
        queuePolicy: { callingWindowOpen: isWithinDialerCallingHours() },
      },
      {
        headers: successHeaders(requestStartedAt, {
          leads: leadsDuration,
          suppression: suppressionDuration,
          context: contextDuration,
        }, { leads: normalizedLeadRows.length, context: context.length, prospects: prospects?.length ?? 0 }),
      },
    )
  } catch (err) {
    console.error('[dialer/queue] Error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
