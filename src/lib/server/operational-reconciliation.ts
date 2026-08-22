import { supabaseAdmin } from '@/lib/supabase/admin'

const PAGE_SIZE = 500
const ROW_CAP = 5_000
const TERMINAL_STATIONS = new Set(['dead', 'closed', 'closed_lost'])

type WorkItemRow = {
  work_item_key: string
  lead_id: string | null
  status: string
  due_at: string | null
  assigned_to: string | null
  primary_next_action: boolean
}

type ThreadRow = {
  thread_key: string
  lead_id: string | null
  last_channel: string | null
  last_activity_at: string
  owner: string | null
}

type LeadRow = {
  id: string
  station: string | null
  classification: string | null
}

export type OperationalReconciliationSnapshot = {
  generatedAt: string
  source: 'bounded_server_audit'
  degraded: boolean
  warning: string | null
  workItems: {
    total: number
    observed: number
    active: number
    overdue: number
    overdueCurrent: number
    overdueTerminal: number
    overdueUnlinked: number
    overdueAssigned: number
    overdueUnassigned: number
    leadsWithMultipleActive: number
    leadsWithMultiplePrimary: number
    maxActivePerLead: number
    age: Record<string, number>
  }
  conversations: {
    needsReply: number
    observed: number
    known: number
    unmatched: number
    terminalKnown: number
    assigned: number
    unassigned: number
    channel: Record<string, number>
    age: Record<string, number>
  }
}

export type OperationalReconciliationRows = {
  workItems: WorkItemRow[]
  workItemTotal: number
  threads: ThreadRow[]
  threadTotal: number
  leads: LeadRow[]
  now: Date
}

function countBy<T>(rows: T[], keyFor: (row: T) => string): Record<string, number> {
  const counts = new Map<string, number>()
  for (const row of rows) {
    const key = keyFor(row)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return Object.fromEntries([...counts].sort(([left], [right]) => left.localeCompare(right)))
}

function isTerminal(lead: LeadRow | undefined) {
  if (!lead) return false
  return TERMINAL_STATIONS.has(String(lead.station || '').toLowerCase())
    || String(lead.classification || '').toLowerCase() === 'dead'
}

function overdueAge(row: WorkItemRow, now: Date) {
  const days = (now.getTime() - new Date(row.due_at as string).getTime()) / 86_400_000
  if (days > 120) return '121_plus_days'
  if (days > 90) return '91_to_120_days'
  if (days > 60) return '61_to_90_days'
  if (days > 30) return '31_to_60_days'
  if (days > 14) return '15_to_30_days'
  if (days > 7) return '8_to_14_days'
  return '1_to_7_days'
}

function conversationAge(row: ThreadRow, now: Date) {
  const days = (now.getTime() - new Date(row.last_activity_at).getTime()) / 86_400_000
  if (days > 180) return '181_plus_days'
  if (days > 90) return '91_to_180_days'
  if (days > 30) return '31_to_90_days'
  if (days > 7) return '8_to_30_days'
  return '0_to_7_days'
}

export function summarizeOperationalReconciliation(
  input: OperationalReconciliationRows,
): OperationalReconciliationSnapshot {
  const leadById = new Map(input.leads.map((lead) => [lead.id, lead]))
  const active = input.workItems.filter((item) => item.status === 'pending' || item.status === 'blocked')
  const overdue = active.filter((item) => item.due_at && new Date(item.due_at) < input.now)
  const activeByLead = countBy(active.filter((item) => item.lead_id), (item) => item.lead_id as string)
  const primaryByLead = countBy(
    active.filter((item) => item.lead_id && item.primary_next_action),
    (item) => item.lead_id as string,
  )
  const degraded = input.workItemTotal > input.workItems.length || input.threadTotal > input.threads.length

  return {
    generatedAt: input.now.toISOString(),
    source: 'bounded_server_audit',
    degraded,
    warning: degraded
      ? `Classification is capped at ${ROW_CAP.toLocaleString()} rows per source; total counts remain exact.`
      : null,
    workItems: {
      total: input.workItemTotal,
      observed: input.workItems.length,
      active: active.length,
      overdue: overdue.length,
      overdueCurrent: overdue.filter((item) => item.lead_id && !isTerminal(leadById.get(item.lead_id))).length,
      overdueTerminal: overdue.filter((item) => item.lead_id && isTerminal(leadById.get(item.lead_id))).length,
      overdueUnlinked: overdue.filter((item) => !item.lead_id).length,
      overdueAssigned: overdue.filter((item) => item.assigned_to).length,
      overdueUnassigned: overdue.filter((item) => !item.assigned_to).length,
      leadsWithMultipleActive: Object.values(activeByLead).filter((count) => count > 1).length,
      leadsWithMultiplePrimary: Object.values(primaryByLead).filter((count) => count > 1).length,
      maxActivePerLead: Math.max(0, ...Object.values(activeByLead)),
      age: countBy(overdue, (item) => overdueAge(item, input.now)),
    },
    conversations: {
      needsReply: input.threadTotal,
      observed: input.threads.length,
      known: input.threads.filter((thread) => thread.lead_id).length,
      unmatched: input.threads.filter((thread) => !thread.lead_id).length,
      terminalKnown: input.threads.filter(
        (thread) => thread.lead_id && isTerminal(leadById.get(thread.lead_id)),
      ).length,
      assigned: input.threads.filter((thread) => thread.owner).length,
      unassigned: input.threads.filter((thread) => !thread.owner).length,
      channel: countBy(input.threads, (thread) => thread.last_channel || 'unknown'),
      age: countBy(input.threads, (thread) => conversationAge(thread, input.now)),
    },
  }
}

async function loadWorkItems() {
  const countResult = await supabaseAdmin()
    .from('work_items')
    .select('work_item_key', { count: 'exact', head: true })
    .eq('department', 'acquisitions')
    .in('status', ['pending', 'blocked', 'completed'])
  if (countResult.error) throw new Error(countResult.error.message)

  const rows: WorkItemRow[] = []
  for (let offset = 0; offset < ROW_CAP; offset += PAGE_SIZE) {
    const result = await supabaseAdmin()
      .from('work_items')
      .select('work_item_key,lead_id,status,due_at,assigned_to,primary_next_action')
      .eq('department', 'acquisitions')
      .in('status', ['pending', 'blocked', 'completed'])
      .order('work_item_key', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (result.error) throw new Error(result.error.message)
    const page = (result.data || []) as WorkItemRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return { rows, total: countResult.count || 0 }
}

async function loadThreads() {
  const countResult = await supabaseAdmin()
    .from('conversation_thread_state')
    .select('thread_key', { count: 'exact', head: true })
    .eq('attention_state', 'needs_reply')
  if (countResult.error) throw new Error(countResult.error.message)

  const rows: ThreadRow[] = []
  for (let offset = 0; offset < ROW_CAP; offset += PAGE_SIZE) {
    const result = await supabaseAdmin()
      .from('conversation_thread_state')
      .select('thread_key,lead_id,last_channel,last_activity_at,owner')
      .eq('attention_state', 'needs_reply')
      .order('thread_key', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)
    if (result.error) throw new Error(result.error.message)
    const page = (result.data || []) as ThreadRow[]
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
  }
  return { rows, total: countResult.count || 0 }
}

async function loadLeads(ids: string[]) {
  const uniqueIds = [...new Set(ids.filter(Boolean))]
  const rows: LeadRow[] = []
  for (let offset = 0; offset < uniqueIds.length; offset += 200) {
    const result = await supabaseAdmin()
      .from('leads')
      .select('id,station,classification')
      .in('id', uniqueIds.slice(offset, offset + 200))
    if (result.error) throw new Error(result.error.message)
    rows.push(...((result.data || []) as LeadRow[]))
  }
  return rows
}

export async function getOperationalReconciliationSnapshot(
  now = new Date(),
): Promise<OperationalReconciliationSnapshot> {
  const [workItems, threads] = await Promise.all([loadWorkItems(), loadThreads()])
  const leads = await loadLeads([
    ...workItems.rows.flatMap((item) => item.lead_id ? [item.lead_id] : []),
    ...threads.rows.flatMap((thread) => thread.lead_id ? [thread.lead_id] : []),
  ])
  return summarizeOperationalReconciliation({
    workItems: workItems.rows,
    workItemTotal: workItems.total,
    threads: threads.rows,
    threadTotal: threads.total,
    leads,
    now,
  })
}
