export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { isWithinDialerCallingHours, phoneLookupVariants } from '@/lib/dialer-call-policy'
import { readDialerQueuePage } from '@/lib/server/dialer-queue-read-model'
import { supabase } from '@/lib/supabase-lazy'

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

const EXPANDED_PROSPECT_SELECT = 'id, lead_id, owner_1, cumulative_due, earliest_delinquent_year, delinquent_years_category, total_market_value, zestimate, situs_street, situs_city, situs_state, situs_zip, mailing_street, mailing_city, mailing_state, mailing_zip, county, is_deceased, occupancy_status'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

interface DialerQueueLeadRow {
  id: string
  phone: string | null
  station: string | null
  classification: string | null
  [key: string]: unknown
}

function successHeaders(
  startedAt: number,
  projectionDuration: number,
  counts: { leads: number; context: number; prospects: number; eligible: number },
): HeadersInit {
  return {
    ...NO_STORE_HEADERS,
    'Server-Timing': [
      `projection;dur=${projectionDuration.toFixed(1)}`,
      `total;dur=${(performance.now() - startedAt).toFixed(1)}`,
    ].join(', '),
    'X-CRM-Row-Counts': `leads=${counts.leads},context=${counts.context},prospects=${counts.prospects},eligible=${counts.eligible}`,
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

export function parseLeadIds(value: string | null): string[] {
  if (!value) return []
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => UUID_PATTERN.test(item))
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
    .limit(1000)

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
    const explicitLeadIdsRequested = searchParams.has('lead_ids')
    const explicitLeadIds = parseLeadIds(searchParams.get('lead_ids'))
    if (explicitLeadIdsRequested && explicitLeadIds.length === 0) {
      return NextResponse.json({ success: false, error: 'No valid lead IDs supplied' }, {
        status: 400,
        headers: NO_STORE_HEADERS,
      })
    }
    const cohortLeadIds = explicitLeadIds.length > 0
      ? []
      : await resolveCohortLeadIds(searchParams.get('cohort'))
    const requestedLeadIds = explicitLeadIds.length > 0 ? explicitLeadIds : cohortLeadIds
    const idsOnly = searchParams.get('ids_only') === '1'
    const limitParam = Number(searchParams.get('limit') || '1000')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 1000) : 1000

    if (idsOnly) {
      return NextResponse.json({ success: true, leadIds: requestedLeadIds }, { headers: NO_STORE_HEADERS })
    }

    const projectionStartedAt = performance.now()
    const page = await readDialerQueuePage({
      limit: requestedLeadIds.length > 0 ? Math.max(requestedLeadIds.length, 1) : limit,
      leadIds: requestedLeadIds.length > 0 ? requestedLeadIds : undefined,
    })
    const projectionDuration = performance.now() - projectionStartedAt
    const leadIds = page.leads
      .map((row) => typeof row.id === 'string' ? row.id : null)
      .filter((id): id is string => Boolean(id))

    if (requestedLeadIds.length > 0) {
      if (leadIds.length === 0) {
        return NextResponse.json({
          success: true,
          leads: [],
          queueContext: [],
          queueMetrics: page.queueMetrics,
          prospects: [],
          queuePolicy: { callingWindowOpen: isWithinDialerCallingHours() },
        }, {
          headers: successHeaders(requestStartedAt, projectionDuration, {
            leads: 0,
            context: 0,
            prospects: 0,
            eligible: page.totalCount,
          }),
        })
      }

      const [prospectResult, coOwnerResult] = await Promise.all([
        supabase
          .from('prospects')
          .select(EXPANDED_PROSPECT_SELECT)
          .in('lead_id', leadIds)
          .limit(Math.min(Math.max(leadIds.length * 5, 100), 1000)),
        supabase
          .from('lead_co_owners')
          .select('lead_id, name')
          .in('lead_id', leadIds)
          .order('created_at', { ascending: true })
          .limit(Math.min(Math.max(leadIds.length * 10, 100), 1000)),
      ])

      if (prospectResult.error || coOwnerResult.error) {
        console.error('[dialer/queue] Context lookup failed', {
          prospects: prospectResult.error?.message,
          coOwners: coOwnerResult.error?.message,
        })
        return NextResponse.json({ success: false, error: 'Dialer context is unavailable' }, { status: 500, headers: NO_STORE_HEADERS })
      }

      return NextResponse.json({
        success: true,
        leads: page.leads,
        queueContext: [],
        queueMetrics: page.queueMetrics,
        prospects: prospectResult.data || [],
        coOwners: coOwnerResult.data || [],
        queuePolicy: { callingWindowOpen: isWithinDialerCallingHours() },
      }, {
        headers: successHeaders(requestStartedAt, projectionDuration, {
          leads: page.leads.length,
          context: 0,
          prospects: prospectResult.data?.length ?? 0,
          eligible: page.totalCount,
        }),
      })
    }

    return NextResponse.json({
      success: true,
      leads: page.leads,
      queueContext: page.queueContext,
      queueMetrics: page.queueMetrics,
      prospects: page.prospects,
      queuePolicy: { callingWindowOpen: isWithinDialerCallingHours() },
    }, {
      headers: successHeaders(requestStartedAt, projectionDuration, {
        leads: page.leads.length,
        context: page.queueContext.length,
        prospects: page.prospects.length,
        eligible: page.totalCount,
      }),
    })
  } catch (err) {
    console.error('[dialer/queue] Error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
