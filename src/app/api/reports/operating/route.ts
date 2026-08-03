export const dynamic = 'force-dynamic'
export const revalidate = 0
export const maxDuration = 60

import { NextRequest, NextResponse } from 'next/server'

import { buildConversationHubThreads, type ConversationHubActivity, type ConversationHubLead } from '@/lib/operating-model/conversation-hub'
import { buildOperatingReport, type OperatingActivity, type OperatingBuyer, type OperatingDeal, type OperatingLead, type OperatingMoneyRow, type OperatingOffer, type OperatingReportPeriod } from '@/lib/operating-report'
import { supabaseAdmin } from '@/lib/supabase/admin'

const NO_STORE_HEADERS: HeadersInit = { 'Cache-Control': 'no-store, max-age=0' }
const PERIODS = new Set<OperatingReportPeriod>(['30d', 'quarter', 'ytd', 'all'])
const PAGE_SIZE = 1000

function periodStart(period: OperatingReportPeriod, now: Date): Date | null {
  if (period === 'all') return null
  if (period === '30d') return new Date(now.getTime() - 30 * 86_400_000)
  if (period === 'ytd') return new Date(now.getFullYear(), 0, 1)
  return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1)
}

function withinPeriod(value: string | null | undefined, since: Date | null, until: Date): boolean {
  if (!value) return false
  const timestamp = new Date(value).getTime()
  if (!Number.isFinite(timestamp) || timestamp > until.getTime()) return false
  return since === null || timestamp >= since.getTime()
}

function configuredNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

async function loadActivities(leadIds: string[]) {
  const db = supabaseAdmin()
  const rows: OperatingActivity[] = []
  if (leadIds.length === 0) return { rows, error: null as string | null, truncated: false }

  for (let from = 0; from < 20_000; from += PAGE_SIZE) {
    const { data, error } = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE_SIZE - 1)

    if (error) return { rows: [], error: error.message, truncated: false }
    const page = (data ?? []) as OperatingActivity[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) return { rows, error: null, truncated: false }
  }

  return { rows, error: null, truncated: true }
}

export async function GET(request: NextRequest) {
  const requested = request.nextUrl.searchParams.get('period') as OperatingReportPeriod | null
  const period = requested && PERIODS.has(requested) ? requested : '30d'
  const until = new Date()
  const since = periodStart(period, until)
  const db = supabaseAdmin()

  const { data: leadData, error: leadError } = await db
    .from('leads')
    .select('id, full_name, phone, email, property_address, city, source, station, priority, assigned_agent, opportunity_score, motivation_score, arv, offer_amount, is_favorite, created_at, is_parked')
    .eq('is_parked', false)
    .neq('station', 'dead')
    .order('created_at', { ascending: false })
    .limit(5000)

  if (leadError) {
    return NextResponse.json({ error: leadError.message }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const referenceLeads = (leadData ?? []) as Array<OperatingLead & { is_parked?: boolean }>
  const leadIds = referenceLeads.map((lead) => lead.id)
  const activityResult = await loadActivities(leadIds)
  if (activityResult.error) {
    return NextResponse.json({ error: activityResult.error }, { status: 500, headers: NO_STORE_HEADERS })
  }

  const [appointmentsResult, enhancedDealsResult, offersResult, buyersResult, revenueResult, expensesResult, rolesResult] = await Promise.all([
    db.from('appointments').select('id, lead_id, status, source, scheduled_at, created_at').order('created_at', { ascending: false }).limit(5000),
    db.from('dispo_deals').select('id, lead_id, stage, entered_at, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id, closeout_status, debrief_due_at, debrief_completed_at, created_at, updated_at').order('updated_at', { ascending: false }).limit(5000),
    db.from('buyer_offers').select('id, lead_id, buyer_id, offer_amount, close_days, status, submitted_at, decided_at, created_at').order('created_at', { ascending: false }).limit(5000),
    db.from('buyers').select('*').order('created_at', { ascending: false }).limit(5000),
    db.from('revenue_transactions').select('id, amount, date, source, description, deal_id, property_address').or('source.is.null,source.neq.seed').order('date', { ascending: false }).limit(5000),
    db.from('expense_transactions').select('id, amount, date, source, description, category').or('source.is.null,source.neq.seed').order('date', { ascending: false }).limit(5000),
    db.from('roles').select('name, kpi_targets'),
  ])

  let dealsResult = enhancedDealsResult
  if (enhancedDealsResult.error) {
    dealsResult = await db
      .from('dispo_deals')
      .select('id, lead_id, stage, entered_at, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(5000) as typeof enhancedDealsResult
  }

  const availability = {
    leads: true,
    conversations: true,
    appointments: !appointmentsResult.error,
    dispositions: !dealsResult.error,
    offers: !offersResult.error,
    buyers: !buyersResult.error,
    finance: !revenueResult.error && !expensesResult.error,
    activityComplete: !activityResult.truncated,
  }

  const cohortLeads = referenceLeads.filter((lead) => withinPeriod(lead.created_at, since, until))
  const hubActivities = activityResult.rows as ConversationHubActivity[]
  const threads = buildConversationHubThreads(
    cohortLeads.map((lead) => ({ ...lead, classification: null, dead_reason: null, county: null, motivation_score: lead.opportunity_score, arv: null, offer_amount: null, appointment_date: null })) as ConversationHubLead[],
    hubActivities,
    until,
  )
  const periodActivities = activityResult.rows.filter((activity) => withinPeriod(activity.created_at, since, until))
  const appointments = appointmentsResult.error
    ? []
    : (appointmentsResult.data ?? []).filter((row) => withinPeriod(row.scheduled_at ?? row.created_at, since, until))
  const deals = dealsResult.error
    ? []
    : (dealsResult.data ?? []).filter((row) =>
      withinPeriod(row.entered_at ?? row.created_at, since, until) ||
      withinPeriod(row.close_date, since, until),
    )
  const dealLeadIds = new Set((deals ?? []).map((deal) => deal.lead_id))
  const offers = offersResult.error
    ? []
    : (offersResult.data ?? []).filter((row) => dealLeadIds.has(row.lead_id) || withinPeriod(row.submitted_at ?? row.created_at, since, until))
  const revenue = revenueResult.error ? [] : (revenueResult.data ?? []).filter((row) => withinPeriod(row.date, since, until))
  const expenses = expensesResult.error ? [] : (expensesResult.data ?? []).filter((row) => withinPeriod(row.date, since, until))
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
    buyers: buyersResult.error ? [] : (buyersResult.data ?? []) as OperatingBuyer[],
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

  return NextResponse.json(report, { headers: NO_STORE_HEADERS })
}
