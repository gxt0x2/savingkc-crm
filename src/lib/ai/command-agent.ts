import { ToolLoopAgent, isStepCount, tool } from 'ai'
import { z } from 'zod'
import { PHONE_SYSTEM } from '@/lib/operating-model/phone-system'
import { WORKFLOW_CATALOG, workflowCategoryLabel } from '@/lib/operating-model/workflow-catalog'
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
  const [leadsResult, activityResult, dealsResult] = await Promise.all([
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
    },
  }
}

export async function searchContacts(query: string) {
  const db = supabaseAdmin()
  const term = query.trim().slice(0, 80)
  if (!term) return []
  const { data, error } = await db.from('leads')
    .select('id, full_name, phone, property_address, city, station, priority, assigned_agent, source, created_at')
    .ilike('full_name', `%${term}%`)
    .order('created_at', { ascending: false })
    .limit(12)
  if (error) throw new Error(error.message)
  return data ?? []
}

const instructions = `You are ARI, the SavingKC operating assistant. You may answer any user request, but you must remain grounded in the CRM and be explicit about what you can and cannot execute.

Operating rules:
- Identity, ownership, communication outcome, stage, next action, and unresolved attention are the system of record.
- Use the read tools before making claims about CRM data, phone routes, workflows, contacts, or performance.
- Never invent a count, route, owner, outcome, or workflow state.
- You currently have read-only tools. If the user asks you to send a call or message, reassign a record, move a stage, publish a workflow, change routing, delete data, or spend money, do not claim it happened. Return a concrete proposed change, affected records, validation checks, rollback, and the confirmation required.
- Prefer concise, operational answers. Lead with the answer and link the user to the relevant CRM surface using paths such as /contacts, /conversations, /dialer, /workflows?section=phones, /workflows?section=all, or /reports.
- Treat phone-number purpose and to/from identity as protected. Flag mismatches rather than assuming they are correct.`

export function createCommandAgent() {
  return new ToolLoopAgent({
    id: 'savingkc-command-agent',
    model: 'openai/gpt-5.4-mini',
    instructions,
    stopWhen: isStepCount(8),
    temperature: 0.2,
    tools: {
      getOperatingSnapshot: tool({
        description: 'Read a live SavingKC CRM operating snapshot for a period. Use for counts, pipeline, owner, source, activity, tasks, deals, and debrief questions.',
        inputSchema: z.object({ days: z.number().int().min(1).max(365).default(30) }),
        execute: async ({ days }) => readOperatingSnapshot(days),
      }),
      getPhoneSystem: tool({
        description: 'Read the canonical master phone-number registry, including voice, SMS, no-answer, outbound, fallback, owner, and workflow paths.',
        inputSchema: z.object({ search: z.string().max(80).optional() }),
        execute: async ({ search }) => {
          const needle = search?.trim().toLowerCase()
          return PHONE_SYSTEM.filter((record) => !needle || [record.number, record.label, record.owner, record.team, record.workflowId, record.healthNote].some((value) => value.toLowerCase().includes(needle)))
        },
      }),
      getWorkflowRegistry: tool({
        description: 'Read the canonical workflow registry with triggers, actions, owner, status, approval policy, and implementation sources.',
        inputSchema: z.object({ search: z.string().max(80).optional() }),
        execute: async ({ search }) => {
          const needle = search?.trim().toLowerCase()
          return WORKFLOW_CATALOG.filter((workflow) => !needle || [workflow.name, workflow.description, workflow.category, workflow.owner.displayName, ...workflow.implementation.sourceFiles].some((value) => value.toLowerCase().includes(needle))).map((workflow) => ({
            ...workflow,
            categoryLabel: workflowCategoryLabel(workflow.category),
          }))
        },
      }),
      findContacts: tool({
        description: 'Find current CRM contacts by exact or partial person name. This is read-only.',
        inputSchema: z.object({ query: z.string().min(1).max(80) }),
        execute: async ({ query }) => searchContacts(query),
      }),
    },
  })
}

export function commandAgentInstructions() {
  return instructions
}
