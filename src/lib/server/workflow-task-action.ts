import type { SupabaseClient } from '@supabase/supabase-js'
import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import { createWorkItem, type WorkItem } from '@/lib/server/work-items'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_FUTURE_DAYS = 366
const PAST_GRACE_MINUTES = 5

export const APPROVED_FOLLOW_UP_WORKFLOW_ID = 'approved-follow-up-task'

export type ApprovedFollowUpInput = {
  leadId: string
  title: string
  notes: string | null
  dueAt: string
  assignedTo: string
  kind: 'follow_up' | 'callback'
  department: 'acquisitions'
  role: 'setter'
  priority: 'normal'
  primaryNextAction: false
}

export class WorkflowInputError extends Error {
  readonly code = 'invalid_workflow_input'
  readonly retryable = false
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function requiredText(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length < minimum || text.length > maximum) {
    throw new WorkflowInputError(`${label} must be between ${minimum} and ${maximum} characters.`)
  }
  return text
}

export function prepareApprovedFollowUpInput(
  value: unknown,
  actorName: string,
  now = new Date(),
  options: { enforceFuture?: boolean } = {},
): ApprovedFollowUpInput {
  const input = record(value)
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : ''
  if (!UUID_PATTERN.test(leadId)) throw new WorkflowInputError('Select a valid CRM contact.')

  const title = requiredText(input.title, 'Title', 3, 160)
  const rawNotes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (rawNotes.length > 2_000) throw new WorkflowInputError('Notes must be 2,000 characters or fewer.')

  const dueAtText = requiredText(input.dueAt, 'Due date', 10, 80)
  const dueAt = new Date(dueAtText)
  if (!Number.isFinite(dueAt.getTime())) throw new WorkflowInputError('Enter a valid due date.')
  const latest = now.getTime() + MAX_FUTURE_DAYS * 24 * 60 * 60_000
  const tooOld = options.enforceFuture !== false && dueAt.getTime() < now.getTime() - PAST_GRACE_MINUTES * 60_000
  if (tooOld || dueAt.getTime() > latest) {
    throw new WorkflowInputError('Due date must be between now and one year from now.')
  }

  const assignee = resolveTaskAssignee(input.assignedTo, actorName, { defaultToActor: true })
  if (!assignee.authorized || !assignee.assignedTo) {
    throw new WorkflowInputError('Choose an approved task owner.')
  }

  const kind = input.kind === 'callback' ? 'callback' : 'follow_up'
  return {
    leadId: leadId.toLowerCase(),
    title,
    notes: rawNotes || null,
    dueAt: dueAt.toISOString(),
    assignedTo: assignee.assignedTo,
    kind,
    department: 'acquisitions',
    role: 'setter',
    priority: 'normal',
    primaryNextAction: false,
  }
}

export async function executeApprovedFollowUpTask(input: {
  runId: string
  workflowVersion: number
  definitionHash: string
  triggerKind: string
  requestedBy: string
  payload: Record<string, unknown>
}, db: SupabaseClient): Promise<{ created: boolean; workItem: WorkItem }> {
  const task = prepareApprovedFollowUpInput(input.payload, input.requestedBy, new Date(), { enforceFuture: false })
  return createWorkItem({
    actor: input.requestedBy,
    idempotencyKey: `${input.runId}:create-follow-up-task`,
    leadId: task.leadId,
    kind: task.kind,
    title: task.title,
    notes: task.notes,
    dueAt: task.dueAt,
    assignedTo: task.assignedTo,
    department: task.department,
    role: task.role,
    priority: task.priority,
    primaryNextAction: task.primaryNextAction,
    provenance: {
      source: 'governed_workflow',
      workflow_id: APPROVED_FOLLOW_UP_WORKFLOW_ID,
      workflow_version: input.workflowVersion,
      workflow_run_id: input.runId,
      workflow_definition_hash: input.definitionHash,
      workflow_trigger_kind: input.triggerKind,
    },
  }, db)
}
