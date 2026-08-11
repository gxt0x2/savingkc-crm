export const EDITABLE_TASK_ACTIVITY_TYPES = [
  'task',
  'appointment',
  'follow_up',
  'callback',
  'send_offer',
] as const

export type EditableTaskActivityType = (typeof EDITABLE_TASK_ACTIVITY_TYPES)[number]
export type EditableTaskStatus = 'pending' | 'completed'

export interface TaskActivityPatch {
  title?: string
  notes?: string
  taskType?: string
  assignedTo?: string | null
  dueDate?: string | null
  status?: EditableTaskStatus
}

export interface ExistingTaskActivity {
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
}

export function isEditableTaskActivityType(value: string): value is EditableTaskActivityType {
  return EDITABLE_TASK_ACTIVITY_TYPES.includes(value as EditableTaskActivityType)
}

export function normalizeTaskActivityPatch(value: unknown): TaskActivityPatch {
  const body = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const patch: TaskActivityPatch = {}

  if (typeof body.title === 'string') patch.title = body.title.trim()
  if (typeof body.notes === 'string') patch.notes = body.notes.trim()
  if (typeof body.taskType === 'string') patch.taskType = body.taskType.trim()
  if (body.assignedTo === null || typeof body.assignedTo === 'string') {
    patch.assignedTo = typeof body.assignedTo === 'string' ? body.assignedTo.trim() || null : null
  }
  if (body.dueDate === null) patch.dueDate = null
  if (typeof body.dueDate === 'string') {
    const parsed = new Date(body.dueDate)
    if (!Number.isNaN(parsed.getTime())) patch.dueDate = parsed.toISOString()
  }
  if (body.status === 'pending' || body.status === 'completed') patch.status = body.status

  return patch
}

export function mergeTaskActivity(
  existing: ExistingTaskActivity,
  patch: TaskActivityPatch,
  changedAt = new Date().toISOString(),
) {
  const metadata: Record<string, unknown> = { ...(existing.metadata || {}) }

  if (patch.title !== undefined) metadata.title = patch.title
  if (patch.notes !== undefined) metadata.notes = patch.notes || undefined
  if (patch.taskType !== undefined) metadata.task_type = patch.taskType
  if (patch.assignedTo !== undefined) metadata.assigned_to = patch.assignedTo
  if (patch.dueDate !== undefined) metadata.due_date = patch.dueDate
  if (patch.status !== undefined) {
    metadata.status = patch.status
    metadata.completed_at = patch.status === 'completed' ? changedAt : null
  }

  metadata.userEdited = true
  metadata.userEditedAt = changedAt

  return {
    description: patch.title !== undefined ? patch.title || existing.description : existing.description,
    agent: patch.assignedTo !== undefined ? patch.assignedTo : existing.agent,
    metadata,
  }
}
