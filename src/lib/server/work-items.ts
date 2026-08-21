import { supabaseAdmin } from '@/lib/supabase/admin'

export const WORK_ITEM_STATUSES = ['pending', 'completed', 'blocked', 'cancelled'] as const
export type WorkItemStatus = (typeof WORK_ITEM_STATUSES)[number]

export interface WorkItem {
  key: string
  sourceKind: 'activity' | 'tc_task'
  sourceId: string
  leadId: string | null
  tcFileId: string | null
  kind: string
  title: string
  description: string | null
  status: WorkItemStatus
  priority: string
  dueAt: string | null
  assignedTo: string | null
  department: string
  role: string | null
  primaryNextAction: boolean
  version: number
  sourceCreatedAt: string
  completedAt: string | null
  updatedAt: string
}

export interface WorkItemPatch {
  title?: string
  notes?: string | null
  kind?: string
  dueAt?: string | null
  assignedTo?: string | null
  status?: 'pending' | 'completed'
}

interface WorkItemRow {
  work_item_key: string
  source_kind: 'activity' | 'tc_task'
  source_id: string
  lead_id: string | null
  tc_file_id: string | null
  kind: string
  title: string
  description: string | null
  status: WorkItemStatus
  priority: string
  due_at: string | null
  assigned_to: string | null
  department: string
  role: string | null
  primary_next_action: boolean
  version: number
  source_created_at: string
  completed_at: string | null
  updated_at: string
}

export class WorkItemError extends Error {
  constructor(
    message: string,
    readonly code: 'unavailable' | 'invalid' | 'not_found' | 'conflict',
  ) {
    super(message)
  }
}

export function normalizeWorkItemKind(value: unknown): 'task' | 'appointment' | 'follow_up' | 'callback' | 'send_offer' {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (normalized === 'appointment' || normalized === 'follow_up' || normalized === 'callback' || normalized === 'send_offer') {
    return normalized
  }
  if (normalized === 'offer') return 'send_offer'
  return 'task'
}

function mapWorkItem(row: WorkItemRow): WorkItem {
  if (!row?.work_item_key || !row.source_id || !WORK_ITEM_STATUSES.includes(row.status)) {
    throw new WorkItemError('Work item state is malformed.', 'unavailable')
  }
  return {
    key: row.work_item_key,
    sourceKind: row.source_kind,
    sourceId: row.source_id,
    leadId: row.lead_id,
    tcFileId: row.tc_file_id,
    kind: row.kind,
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    dueAt: row.due_at,
    assignedTo: row.assigned_to,
    department: row.department,
    role: row.role,
    primaryNextAction: row.primary_next_action,
    version: row.version,
    sourceCreatedAt: row.source_created_at,
    completedAt: row.completed_at,
    updatedAt: row.updated_at,
  }
}

function databaseError(message: string): never {
  const normalized = message.toLowerCase()
  if (normalized.includes('work_item_not_found')) {
    throw new WorkItemError('Work item was not found.', 'not_found')
  }
  if (normalized.includes('version_conflict') || normalized.includes('idempotency_conflict')) {
    throw new WorkItemError('Work item changed in another request. Refresh and try again.', 'conflict')
  }
  if (
    normalized.includes('invalid_') ||
    normalized.includes('_required') ||
    normalized.includes('too_many_work_items') ||
    normalized.includes('empty_work_item_patch')
  ) {
    throw new WorkItemError('The work-item request is invalid.', 'invalid')
  }
  if (
    normalized.includes('does not exist') ||
    normalized.includes('schema cache') ||
    normalized.includes('pgrst202') ||
    normalized.includes('pgrst205')
  ) {
    throw new WorkItemError('The canonical work-item service is not installed.', 'unavailable')
  }
  throw new WorkItemError('Work item service is unavailable.', 'unavailable')
}

export async function listWorkItems(input: {
  department?: string
  statuses?: WorkItemStatus[]
  leadId?: string
  leadIds?: string[]
  assignedTo?: string
  dueBefore?: string
  dueAfter?: string
  completedAfter?: string
  limit?: number
} = {}): Promise<WorkItem[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 500, 500))
  let query = supabaseAdmin()
    .from('work_items')
    .select('work_item_key, source_kind, source_id, lead_id, tc_file_id, kind, title, description, status, priority, due_at, assigned_to, department, role, primary_next_action, version, source_created_at, completed_at, updated_at')
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('work_item_key', { ascending: true })
    .limit(limit)

  if (input.department) query = query.eq('department', input.department)
  if (input.statuses?.length) query = query.in('status', input.statuses)
  if (input.leadId) query = query.eq('lead_id', input.leadId)
  if (input.leadIds?.length) query = query.in('lead_id', input.leadIds)
  if (input.assignedTo) query = query.ilike('assigned_to', input.assignedTo)
  if (input.dueBefore) query = query.lte('due_at', input.dueBefore)
  if (input.dueAfter) query = query.gte('due_at', input.dueAfter)
  if (input.completedAfter) query = query.gte('completed_at', input.completedAfter)

  const { data, error } = await query
  if (error) databaseError(error.message)
  return ((data || []) as WorkItemRow[]).map(mapWorkItem)
}

export async function listCompletedWorkItemDates(input: {
  completedAfter: string
  limit?: number
}): Promise<string[]> {
  const limit = Math.max(1, Math.min(input.limit ?? 5_000, 5_000))
  const { data, error } = await supabaseAdmin()
    .from('work_items')
    .select('completed_at')
    .eq('status', 'completed')
    .not('completed_at', 'is', null)
    .gte('completed_at', input.completedAfter)
    .order('completed_at', { ascending: true })
    .limit(limit)
  if (error) databaseError(error.message)
  return (data || []).flatMap((row) => typeof row.completed_at === 'string' ? [row.completed_at] : [])
}

export async function createWorkItem(input: {
  actor: string
  idempotencyKey: string
  leadId?: string | null
  kind: string
  title: string
  notes?: string | null
  dueAt?: string | null
  assignedTo: string
  department: string
  role?: string | null
  priority?: string
  primaryNextAction?: boolean
}): Promise<{ created: boolean; workItem: WorkItem }> {
  const { data, error } = await supabaseAdmin().rpc('create_work_item_v1', {
    p_actor: input.actor,
    p_idempotency_key: input.idempotencyKey,
    p_lead_id: input.leadId || null,
    p_kind: input.kind,
    p_title: input.title,
    p_notes: input.notes || null,
    p_due_at: input.dueAt || null,
    p_assigned_to: input.assignedTo,
    p_department: input.department,
    p_role: input.role || null,
    p_priority: input.priority || 'normal',
    p_primary_next_action: input.primaryNextAction === true,
  })
  if (error) databaseError(error.message)
  const result = data as { created?: boolean; workItem?: WorkItemRow } | null
  if (!result?.workItem) databaseError('work item create returned malformed state')
  return { created: result.created === true, workItem: mapWorkItem(result.workItem) }
}

export async function transitionWorkItem(input: {
  key: string
  actor: string
  action: 'complete' | 'reopen' | 'snooze' | 'assign' | 'cancel' | 'edit'
  idempotencyKey: string
  expectedVersion?: number | null
  patch?: WorkItemPatch
}): Promise<{ changed: boolean; workItem: WorkItem }> {
  const patch: Record<string, unknown> = {}
  if (input.patch) {
    if ('title' in input.patch) patch.title = input.patch.title
    if ('notes' in input.patch) patch.notes = input.patch.notes
    if ('kind' in input.patch) patch.kind = input.patch.kind
    if ('dueAt' in input.patch) patch.due_at = input.patch.dueAt
    if ('assignedTo' in input.patch) patch.assigned_to = input.patch.assignedTo
    if ('status' in input.patch) patch.status = input.patch.status
  }
  const { data, error } = await supabaseAdmin().rpc('transition_work_item_v1', {
    p_work_item_key: input.key,
    p_actor: input.actor,
    p_action: input.action,
    p_idempotency_key: input.idempotencyKey,
    p_expected_version: input.expectedVersion ?? null,
    p_patch: patch,
  })
  if (error) databaseError(error.message)
  const result = data as { changed?: boolean; workItem?: WorkItemRow } | null
  if (!result?.workItem) databaseError('work item transition returned malformed state')
  return { changed: result.changed === true, workItem: mapWorkItem(result.workItem) }
}

export async function transitionWorkItemsBulk(input: {
  keys: string[]
  actor: string
  action: 'complete' | 'reopen' | 'cancel' | 'edit'
  idempotencyKey: string
  patch?: WorkItemPatch
}): Promise<{ changed: number; workItems: WorkItem[] }> {
  const patch: Record<string, unknown> = {}
  if (input.patch) {
    if ('title' in input.patch) patch.title = input.patch.title
    if ('notes' in input.patch) patch.notes = input.patch.notes
    if ('kind' in input.patch) patch.kind = input.patch.kind
    if ('dueAt' in input.patch) patch.due_at = input.patch.dueAt
    if ('assignedTo' in input.patch) patch.assigned_to = input.patch.assignedTo
    if ('status' in input.patch) patch.status = input.patch.status
  }
  const { data, error } = await supabaseAdmin().rpc('transition_work_items_bulk_v1', {
    p_work_item_keys: input.keys,
    p_actor: input.actor,
    p_action: input.action,
    p_idempotency_key: input.idempotencyKey,
    p_patch: patch,
  })
  if (error) databaseError(error.message)
  const result = data as { changed?: number; workItems?: WorkItemRow[] } | null
  if (!result || !Array.isArray(result.workItems)) databaseError('bulk transition returned malformed state')
  return {
    changed: typeof result.changed === 'number' ? result.changed : result.workItems.length,
    workItems: result.workItems.map(mapWorkItem),
  }
}
