import { supabaseAdmin } from '@/lib/supabase/admin'

type LeadRow = {
  id: string
  full_name: string | null
  property_address: string | null
  city: string | null
  source: string | null
  station: string | null
  priority: string | null
  assigned_agent: string | null
  created_at: string
}

function configuredNumber(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function countBy(rows: LeadRow[], key: 'source' | 'station' | 'assigned_agent') {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const value = row[key]?.trim() || 'Unassigned / not recorded'
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([label, count]) => ({ label, count }))
}

export async function readOperatingSnapshot(days = 30) {
  const db = supabaseAdmin()
  const since = new Date(Date.now() - Math.max(1, Math.min(days, 365)) * 86_400_000).toISOString()
  const [leadsResult, activityResult, dealsResult, rolesResult] = await Promise.all([
    db.from('leads')
      .select('id, full_name, property_address, city, source, station, priority, assigned_agent, created_at')
      .eq('is_parked', false)
      .or('station.is.null,station.neq.dead')
      .order('created_at', { ascending: false })
      .limit(5000),
    db.from('lead_activities')
      .select('id, lead_id, activity_type, agent, metadata, created_at')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(5000),
    db.from('dispo_deals')
      .select('id, lead_id, stage, closeout_status, assignment_fee, close_date, debrief_due_at, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(1000),
    db.from('roles').select('name, kpi_targets'),
  ])

  if (leadsResult.error) throw new Error(`Lead snapshot unavailable: ${leadsResult.error.message}`)
  const leads = (leadsResult.data ?? []) as LeadRow[]
  const activities = activityResult.error ? [] : activityResult.data ?? []
  const deals = dealsResult.error ? [] : dealsResult.data ?? []
  const recentLeads = leads.filter((lead) => lead.created_at >= since)
  const hotLeads = leads.filter((lead) => lead.priority?.toLowerCase() === 'hot')
  const pendingTasks = activities.filter((activity) => activity.activity_type === 'task' && activity.metadata?.status !== 'completed')
  const closedDeals = deals.filter((deal) => deal.stage === 'closed' || deal.closeout_status === 'complete' || deal.closeout_status === 'awaiting_debrief')
  const debriefsDue = deals.filter((deal) => deal.closeout_status === 'awaiting_debrief')
  const ownerTargets = (rolesResult.data ?? []).find((role) => role.name === 'Owner/Operator')?.kpi_targets as Record<string, unknown> | null | undefined
  const acquisitionTargets = (rolesResult.data ?? []).find((role) => role.name === 'Acquisition Agent')?.kpi_targets as Record<string, unknown> | null | undefined

  return {
    periodDays: days,
    generatedAt: new Date().toISOString(),
    activeLeads: leads.length,
    newLeads: recentLeads.length,
    hotLeads: hotLeads.length,
    recordedActivities: activities.length,
    pendingTasks: pendingTasks.length,
    dispositionDeals: deals.length,
    closedDeals: closedDeals.length,
    debriefsDue: debriefsDue.length,
    goals: {
      monthlyRevenue: configuredNumber(ownerTargets?.monthly_revenue_target),
      monthlyClosings: configuredNumber(ownerTargets?.deals_closed_per_month),
      dailyCalls: configuredNumber(acquisitionTargets?.daily_call_volume),
      weeklyOpportunities: configuredNumber(acquisitionTargets?.leads_qualified_per_week),
      weeklyAppointments: configuredNumber(acquisitionTargets?.appointments_set_per_week),
    },
    operatingPath: [
      'Marketing creates a new seller inquiry',
      'Acquisitions establishes meaningful two-way contact and classifies the record',
      'Lead advances to Opportunity, Appointment, Offer, and Under Contract',
      'Dispositions and Transaction Coordination move the contract through buyer selection and closing',
      'Closing is followed by debrief, verified closeout, and workflow improvement',
    ],
    byStage: countBy(leads, 'station'),
    byOwner: countBy(leads, 'assigned_agent'),
    bySource: countBy(recentLeads, 'source'),
    recentPriorityRecords: hotLeads.slice(0, 12).map((lead) => ({
      id: lead.id,
      name: lead.full_name || 'Unknown',
      property: [lead.property_address, lead.city].filter(Boolean).join(', ') || 'No property recorded',
      stage: lead.station || 'not recorded',
      owner: lead.assigned_agent || 'Unassigned',
      createdAt: lead.created_at,
    })),
    availability: {
      activities: activityResult.error ? activityResult.error.message : 'available',
      dispositions: dealsResult.error ? dealsResult.error.message : 'available',
      goals: rolesResult.error ? rolesResult.error.message : 'available',
    },
  }
}
