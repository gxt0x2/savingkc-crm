export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'

import { buildOperatingReport, type OperatingActivity, type OperatingBuyer, type OperatingDeal, type OperatingLead, type OperatingMoneyRow, type OperatingOffer, type OperatingReportPeriod } from '@/lib/operating-report'
import { isNotLeadOutcome } from '@/lib/lead-outcomes'
import {
  chunksOf,
  conversationStatesToThreads,
  OPERATING_REPORT_ACTIVITY_LIMIT,
  OPERATING_REPORT_ROW_LIMIT,
  takeBoundedRows,
  uniqueRowsById,
  type ConversationReportStateRow,
} from '@/lib/server/operating-report-source'
import { supabaseAdmin } from '@/lib/supabase/admin'

const NO_STORE_HEADERS: HeadersInit = { 'Cache-Control': 'no-store, max-age=0' }
const PERIODS = new Set<OperatingReportPeriod>(['today', '30d', 'quarter', 'ytd', 'all', 'custom'])
const LEAD_SELECT = 'id, full_name, phone, email, property_address, city, source, station, priority, assigned_agent, opportunity_score, motivation_score, arv, offer_amount, classification, dead_reason, is_favorite, created_at, is_parked'
const DEAL_SELECT = 'id, lead_id, stage, entered_at, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id, closeout_status, debrief_due_at, debrief_completed_at, created_at, updated_at'
const DEAL_FALLBACK_SELECT = 'id, lead_id, stage, entered_at, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id, created_at, updated_at'
const OFFER_SELECT = 'id, lead_id, buyer_id, offer_amount, close_days, status, submitted_at, decided_at, created_at'

function periodStart(period: OperatingReportPeriod, now: Date): Date | null {
  if (period === 'all') return null
  if (period === 'today') {
    const start = new Date(now)
    start.setHours(0, 0, 0, 0)
    return start
  }
  if (period === 'custom') return new Date(now.getTime() - 30 * 86_400_000)
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000)
  if (period === 'ytd') return new Date(now.getFullYear(), 0, 1)
  return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
}

function configuredNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function periodOrFilter(primaryColumn: string, fallbackColumn: string, since: Date | null, until: Date): string {
  const end = until.toISOString()
  if (since === null) {
    return `${primaryColumn}.lte.${end},and(${primaryColumn}.is.null,${fallbackColumn}.lte.${end})`
  }
  const start = since.toISOString()
  return `and(${primaryColumn}.gte.${start},${primaryColumn}.lte.${end}),and(${primaryColumn}.is.null,${fallbackColumn}.gte.${start},${fallbackColumn}.lte.${end})`
}

function dealPeriodFilter(since: Date | null, until: Date): string {
  const end = until.toISOString()
  const endDate = end.slice(0, 10)
  if (since === null) return `entered_at.lte.${end},close_date.lte.${endDate}`
  const start = since.toISOString()
  const startDate = start.slice(0, 10)
  return `and(entered_at.gte.${start},entered_at.lte.${end}),and(close_date.gte.${startDate},close_date.lte.${endDate})`
}

function unavailable(message: string, startedAt: number) {
  console.error(`[operating-report] ${message}`)
  return NextResponse.json(
    { error: 'Operating report data is temporarily unavailable.' },
    {
      status: 503,
      headers: {
        ...NO_STORE_HEADERS,
        'Server-Timing': `total;dur=${Math.round(performance.now() - startedAt)}`,
      },
    },
  )
}

export async function GET(request: NextRequest) {
  const startedAt = performance.now()
  const requested = request.nextUrl.searchParams.get('period') as OperatingReportPeriod | null
  const period = requested && PERIODS.has(requested) ? requested : '30d'
  const requestedStart = request.nextUrl.searchParams.get('start')
  const requestedEnd = request.nextUrl.searchParams.get('end')
  const parsedEnd = requestedEnd ? new Date(requestedEnd) : null
  const until = parsedEnd && Number.isFinite(parsedEnd.getTime()) ? parsedEnd : new Date()
  const parsedStart = requestedStart ? new Date(requestedStart) : null
  const since = parsedStart && Number.isFinite(parsedStart.getTime()) ? parsedStart : periodStart(period, until)
  if (since && since.getTime() > until.getTime()) {
    return NextResponse.json({ error: 'The report start date must be before the end date.' }, { status: 400, headers: NO_STORE_HEADERS })
  }
  const db = supabaseAdmin()

  let leadQuery = db
    .from('leads')
    .select(LEAD_SELECT)
    .eq('is_parked', false)
    .lte('created_at', until.toISOString())
    .order('created_at', { ascending: false })
    .limit(OPERATING_REPORT_ROW_LIMIT + 1)
  if (since) leadQuery = leadQuery.gte('created_at', since.toISOString())

  let activityQuery = db
    .from('lead_activities')
    .select('id, lead_id, activity_type, description, agent, metadata, created_at')
    .lte('created_at', until.toISOString())
    .order('created_at', { ascending: false })
    .limit(OPERATING_REPORT_ACTIVITY_LIMIT + 1)
  if (since) activityQuery = activityQuery.gte('created_at', since.toISOString())

  const appointmentQuery = db
    .from('appointments')
    .select('id, lead_id, status, source, scheduled_at, created_at')
    .or(periodOrFilter('scheduled_at', 'created_at', since, until))
    .order('scheduled_at', { ascending: false, nullsFirst: false })
    .limit(OPERATING_REPORT_ROW_LIMIT + 1)

  const dealQuery = db
    .from('dispo_deals')
    .select(DEAL_SELECT)
    .or(dealPeriodFilter(since, until))
    .order('updated_at', { ascending: false })
    .limit(OPERATING_REPORT_ROW_LIMIT + 1)

  const buyersQuery = db
    .from('buyers')
    .select('*')
    .lte('created_at', until.toISOString())
    .order('created_at', { ascending: false })
    .limit(OPERATING_REPORT_ROW_LIMIT + 1)

  let revenueQuery = db
    .from('revenue_transactions')
    .select('id, amount, date, source, description, deal_id, property_address')
    .or('source.is.null,source.neq.seed')
    .lte('date', until.toISOString().slice(0, 10))
    .order('date', { ascending: false })
    .limit(OPERATING_REPORT_ROW_LIMIT + 1)
  if (since) revenueQuery = revenueQuery.gte('date', since.toISOString().slice(0, 10))

  let expensesQuery = db
    .from('expense_transactions')
    .select('id, amount, date, source, description, category')
    .or('source.is.null,source.neq.seed')
    .lte('date', until.toISOString().slice(0, 10))
    .order('date', { ascending: false })
    .limit(OPERATING_REPORT_ROW_LIMIT + 1)
  if (since) expensesQuery = expensesQuery.gte('date', since.toISOString().slice(0, 10))

  const [leadResult, activitySourceResult, appointmentsSourceResult, enhancedDealsResult, buyersSourceResult, revenueSourceResult, expensesSourceResult, rolesResult] = await Promise.all([
    leadQuery,
    activityQuery,
    appointmentQuery,
    dealQuery,
    buyersQuery,
    revenueQuery,
    expensesQuery,
    db.from('roles').select('name, kpi_targets'),
  ])

  if (leadResult.error) return unavailable(`lead query failed: ${leadResult.error.message}`, startedAt)
  if (activitySourceResult.error) return unavailable(`activity query failed: ${activitySourceResult.error.message}`, startedAt)

  let dealsResult = enhancedDealsResult
  if (enhancedDealsResult.error) {
    dealsResult = await db
      .from('dispo_deals')
      .select(DEAL_FALLBACK_SELECT)
      .or(dealPeriodFilter(since, until))
      .order('updated_at', { ascending: false })
      .limit(OPERATING_REPORT_ROW_LIMIT + 1) as typeof enhancedDealsResult
  }

  const leadBounded = takeBoundedRows((leadResult.data ?? []) as unknown as OperatingLead[], OPERATING_REPORT_ROW_LIMIT)
  const activityBounded = takeBoundedRows((activitySourceResult.data ?? []) as OperatingActivity[], OPERATING_REPORT_ACTIVITY_LIMIT)
  const appointmentBounded = takeBoundedRows(appointmentsSourceResult.data ?? [], OPERATING_REPORT_ROW_LIMIT)
  const dealBounded = takeBoundedRows((dealsResult.data ?? []) as unknown as OperatingDeal[], OPERATING_REPORT_ROW_LIMIT)
  const buyerBounded = takeBoundedRows((buyersSourceResult.data ?? []) as OperatingBuyer[], OPERATING_REPORT_ROW_LIMIT)
  const revenueBounded = takeBoundedRows((revenueSourceResult.data ?? []) as OperatingMoneyRow[], OPERATING_REPORT_ROW_LIMIT)
  const expenseBounded = takeBoundedRows((expensesSourceResult.data ?? []) as OperatingMoneyRow[], OPERATING_REPORT_ROW_LIMIT)

  const offerPeriodQuery = db
    .from('buyer_offers')
    .select(OFFER_SELECT)
    .or(periodOrFilter('submitted_at', 'created_at', since, until))
    .order('created_at', { ascending: false })
    .limit(OPERATING_REPORT_ROW_LIMIT + 1)
  const offerPeriodResult = await offerPeriodQuery

  const dealLeadIds = [...new Set(dealBounded.rows.map((deal) => deal.lead_id).filter(Boolean))]
  const linkedOffers: OperatingOffer[] = []
  let linkedOffersError: string | null = null
  let linkedOffersComplete = true
  if (!offerPeriodResult.error && since !== null) {
    for (const ids of chunksOf(dealLeadIds)) {
      const remaining = OPERATING_REPORT_ROW_LIMIT + 1 - linkedOffers.length
      if (remaining <= 0) break
      const result = await db
        .from('buyer_offers')
        .select(OFFER_SELECT)
        .in('lead_id', ids)
        .order('created_at', { ascending: false })
        .limit(remaining)
      if (result.error) {
        linkedOffersError = result.error.message
        break
      }
      const rows = (result.data ?? []) as unknown as OperatingOffer[]
      linkedOffers.push(...rows)
      if (rows.length >= remaining) linkedOffersComplete = false
    }
  }
  const offerRows = uniqueRowsById(
    (offerPeriodResult.data ?? []) as unknown as OperatingOffer[],
    linkedOffers,
  )
  const offerBounded = takeBoundedRows(offerRows, OPERATING_REPORT_ROW_LIMIT)

  const cohortLeadIds = leadBounded.rows
    .filter((lead) => !isNotLeadOutcome(lead.classification, lead.station))
    .map((lead) => lead.id)
  const stateRows: ConversationReportStateRow[] = []
  let stateError: string | null = null
  for (const ids of chunksOf(cohortLeadIds)) {
    const result = await db
      .from('conversation_thread_state')
      .select('lead_id, attention_state, owner, last_activity_at, primary_next_action_id, primary_next_action_due_at')
      .in('lead_id', ids)
      .limit(ids.length + 1)
    if (result.error) {
      stateError = result.error.message
      break
    }
    stateRows.push(...(result.data ?? []) as ConversationReportStateRow[])
  }

  const missingReferenceIds = dealLeadIds.filter((id) => !leadBounded.rows.some((lead) => lead.id === id))
  const referenceRows: OperatingLead[] = []
  let referenceError: string | null = null
  for (const ids of chunksOf(missingReferenceIds)) {
    const result = await db.from('leads').select(LEAD_SELECT).in('id', ids).limit(ids.length)
    if (result.error) {
      referenceError = result.error.message
      break
    }
    referenceRows.push(...(result.data ?? []) as unknown as OperatingLead[])
  }
  const referenceLeads = uniqueRowsById(leadBounded.rows, referenceRows)

  const availability = {
    leads: leadBounded.complete,
    conversations: stateError === null && stateRows.length <= OPERATING_REPORT_ROW_LIMIT,
    appointments: !appointmentsSourceResult.error && appointmentBounded.complete,
    dispositions: !dealsResult.error && dealBounded.complete && referenceError === null,
    offers: !offerPeriodResult.error && linkedOffersError === null && linkedOffersComplete && offerBounded.complete,
    buyers: !buyersSourceResult.error && buyerBounded.complete,
    finance: !revenueSourceResult.error && !expensesSourceResult.error && revenueBounded.complete && expenseBounded.complete,
    activityComplete: activityBounded.complete,
  }

  const cohortLeads = leadBounded.rows
  const threads = stateError ? [] : conversationStatesToThreads(stateRows, until)
  const periodActivities = activityBounded.rows
  const appointments = appointmentsSourceResult.error ? [] : appointmentBounded.rows
  const deals = dealsResult.error ? [] : dealBounded.rows
  const offers = offerPeriodResult.error || linkedOffersError ? [] : offerBounded.rows
  const revenue = revenueSourceResult.error ? [] : revenueBounded.rows
  const expenses = expensesSourceResult.error ? [] : expenseBounded.rows
  const ownerTargets = (rolesResult.data ?? []).find((role) => role.name === 'Owner/Operator')?.kpi_targets as Record<string, unknown> | null | undefined
  const acquisitionTargets = (rolesResult.data ?? []).find((role) => role.name === 'Acquisition Agent')?.kpi_targets as Record<string, unknown> | null | undefined

  const report = buildOperatingReport({
    period,
    since: since?.toISOString() ?? null,
    until: until.toISOString(),
    leads: cohortLeads,
    referenceLeads,
    threads,
    activities: periodActivities,
    appointments,
    deals: deals as OperatingDeal[],
    offers: offers as OperatingOffer[],
    buyers: buyersSourceResult.error ? [] : buyerBounded.rows,
    revenue: revenue as OperatingMoneyRow[],
    expenses: expenses as OperatingMoneyRow[],
    goals: {
      monthlyRevenue: configuredNumber(ownerTargets?.monthly_revenue_target),
      monthlyClosings: configuredNumber(ownerTargets?.deals_closed_per_month),
      dailyCalls: configuredNumber(acquisitionTargets?.daily_call_volume),
      weeklyQualified: configuredNumber(acquisitionTargets?.leads_qualified_per_week),
      weeklyAppointments: configuredNumber(acquisitionTargets?.appointments_set_per_week),
    },
    availability,
  })

  return NextResponse.json(report, {
    headers: {
      ...NO_STORE_HEADERS,
      'Server-Timing': `total;dur=${Math.round(performance.now() - startedAt)}, leads;desc=\"${cohortLeads.length} rows\", activities;desc=\"${periodActivities.length} rows\"`,
    },
  })
}
