import { supabaseAdmin } from '@/lib/supabase/admin'

export const TASK_WORKLIST_VIEWS = ['all', 'due_today', 'overdue', 'upcoming', 'completed'] as const
export const TASK_WORKLIST_STATUS_FILTERS = ['all', 'active', 'completed'] as const
export const TASK_WORKLIST_DUE_FILTERS = ['any', 'no_due', 'seven_days', 'thirty_days'] as const
export const TASK_WORKLIST_SORTS = ['due_asc', 'due_desc', 'newest', 'title'] as const

export type TaskWorklistView = (typeof TASK_WORKLIST_VIEWS)[number]
export type TaskWorklistStatusFilter = (typeof TASK_WORKLIST_STATUS_FILTERS)[number]
export type TaskWorklistDueFilter = (typeof TASK_WORKLIST_DUE_FILTERS)[number]
export type TaskWorklistSort = (typeof TASK_WORKLIST_SORTS)[number]

export type TaskWorklistContact = {
  id: string
  fullName: string | null
  phone: string | null
  email: string | null
  propertyAddress: string | null
  city: string | null
  state: string | null
  zip: string | null
  station: string | null
  createdAt: string | null
}

export type TaskWorklistItem = {
  key: string
  sourceKind: 'activity' | 'tc_task'
  sourceId: string
  leadId: string | null
  tcFileId: string | null
  kind: string
  title: string
  description: string | null
  status: 'pending' | 'completed' | 'blocked'
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
  contact: TaskWorklistContact | null
}

export type TaskWorklistCounts = Record<TaskWorklistView, number>

export type TaskWorklistPage = {
  items: TaskWorklistItem[]
  counts: TaskWorklistCounts
  pageInfo: { limit: number; total: number; hasMore: boolean; nextCursor: string | null }
  serverNow: string
}

type Cursor = { sort: TaskWorklistSort; value: string | null; key: string; nullValue: boolean }

export class TaskWorklistError extends Error {
  constructor(message: string, readonly code: 'invalid' | 'unavailable') {
    super(message)
  }
}

function isOneOf<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value)
}

function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url')
}

function decodeCursor(raw: string | null, expectedSort: TaskWorklistSort): Cursor | null {
  if (!raw) return null
  if (raw.length > 500) throw new TaskWorklistError('Task cursor is invalid.', 'invalid')
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Partial<Cursor>
    if (value.sort !== expectedSort || typeof value.key !== 'string' || value.key.length < 1 || value.key.length > 160) throw new Error('invalid')
    if (typeof value.nullValue !== 'boolean') throw new Error('invalid')
    if (value.value !== null && typeof value.value !== 'string') throw new Error('invalid')
    return { sort: value.sort, key: value.key, value: value.value ?? null, nullValue: value.nullValue }
  } catch {
    throw new TaskWorklistError('Task cursor is invalid.', 'invalid')
  }
}

function taskKinds(filter: string): string[] | null {
  if (!filter || filter === 'any') return null
  if (filter === 'offer') return ['send_offer']
  if (filter === 'general') return ['task', 'review', 'research']
  if (['follow_up', 'callback', 'appointment'].includes(filter)) return [filter]
  throw new TaskWorklistError('Task type filter is invalid.', 'invalid')
}

function centralDayBounds(now: Date): { start: string; end: string } {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  function parts(value: Date) {
    const mapped = Object.fromEntries(formatter.formatToParts(value).map((part) => [part.type, part.value]))
    return {
      year: Number(mapped.year), month: Number(mapped.month), day: Number(mapped.day),
      hour: Number(mapped.hour), minute: Number(mapped.minute), second: Number(mapped.second),
    }
  }
  function midnight(year: number, month: number, day: number): string {
    const guess = Date.UTC(year, month - 1, day)
    const localAtGuess = parts(new Date(guess))
    const representedLocal = Date.UTC(
      localAtGuess.year, localAtGuess.month - 1, localAtGuess.day,
      localAtGuess.hour, localAtGuess.minute, localAtGuess.second,
    )
    return new Date(guess - (representedLocal - guess)).toISOString()
  }
  const local = parts(now)
  const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + 1))
  return {
    start: midnight(local.year, local.month, local.day),
    end: midnight(nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate()),
  }
}

function parseItem(value: unknown): TaskWorklistItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (typeof row.key !== 'string' || typeof row.sourceId !== 'string' || typeof row.title !== 'string') return null
  if (row.sourceKind !== 'activity' && row.sourceKind !== 'tc_task') return null
  if (row.status !== 'pending' && row.status !== 'completed' && row.status !== 'blocked') return null
  if (typeof row.version !== 'number' || !Number.isInteger(row.version) || row.version < 1) return null
  return row as TaskWorklistItem
}

function nextCursorFor(item: TaskWorklistItem, sort: TaskWorklistSort): string {
  const value = sort === 'newest'
    ? item.sourceCreatedAt
    : sort === 'title'
      ? item.title.toLowerCase()
      : item.dueAt
  return encodeCursor({ sort, value, key: item.key, nullValue: value === null })
}

export async function getTaskWorklist(input: {
  department?: string
  view?: string
  status?: string
  assignee?: string
  due?: string
  type?: string
  query?: string
  sort?: string
  limit?: number
  cursor?: string | null
  now?: Date
}): Promise<TaskWorklistPage> {
  const department = input.department?.trim().toLowerCase() || 'acquisitions'
  const view = input.view?.trim().toLowerCase() || 'all'
  const status = input.status?.trim().toLowerCase() || 'all'
  const due = input.due?.trim().toLowerCase() || 'any'
  const sort = input.sort?.trim().toLowerCase() || 'due_asc'
  const query = input.query?.trim() || null
  if (!['acquisitions', 'dispositions', 'tc'].includes(department)) throw new TaskWorklistError('Task department is invalid.', 'invalid')
  if (!isOneOf(view, TASK_WORKLIST_VIEWS)) throw new TaskWorklistError('Task view is invalid.', 'invalid')
  if (!isOneOf(status, TASK_WORKLIST_STATUS_FILTERS)) throw new TaskWorklistError('Task status filter is invalid.', 'invalid')
  if (!isOneOf(due, TASK_WORKLIST_DUE_FILTERS)) throw new TaskWorklistError('Task due-date filter is invalid.', 'invalid')
  if (!isOneOf(sort, TASK_WORKLIST_SORTS)) throw new TaskWorklistError('Task sort is invalid.', 'invalid')
  if (query && query.length < 3) throw new TaskWorklistError('Task search must contain at least 3 characters.', 'invalid')
  if (query && query.length > 100) throw new TaskWorklistError('Task search is too long.', 'invalid')

  const cursor = decodeCursor(input.cursor ?? null, sort)
  const now = input.now ?? new Date()
  const bounds = centralDayBounds(now)
  const requestedLimit = input.limit ?? 20
  if (!Number.isFinite(requestedLimit)) throw new TaskWorklistError('Task page limit is invalid.', 'invalid')
  const limit = Math.max(1, Math.min(Math.trunc(requestedLimit), 50))
  const { data, error } = await supabaseAdmin().rpc('task_worklist_page_v1', {
    p_department: department,
    p_view: view,
    p_status_filter: status,
    p_assignee: input.assignee?.trim() || null,
    p_due_filter: due,
    p_kinds: taskKinds(input.type || 'any'),
    p_query: query,
    p_sort: sort,
    p_limit: limit,
    p_now: now.toISOString(),
    p_today_start: bounds.start,
    p_tomorrow_start: bounds.end,
    p_cursor_value: cursor?.value ?? null,
    p_cursor_key: cursor?.key ?? null,
    p_cursor_null: cursor?.nullValue ?? false,
  })
  if (error) {
    const invalid = error.message.toLowerCase().includes('invalid_task') || error.message.toLowerCase().includes('task_query_too_long')
    throw new TaskWorklistError(invalid ? 'Task worklist request is invalid.' : 'Task worklist is unavailable.', invalid ? 'invalid' : 'unavailable')
  }
  const result = data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : null
  if (!result || !Array.isArray(result.items) || !result.counts || typeof result.counts !== 'object') {
    throw new TaskWorklistError('Task worklist is unavailable.', 'unavailable')
  }
  const items = result.items.map(parseItem)
  if (items.some((item) => item === null)) throw new TaskWorklistError('Task worklist is unavailable.', 'unavailable')
  const parsedItems = items as TaskWorklistItem[]
  const countsValue = result.counts as Record<string, unknown>
  const counts = Object.fromEntries(TASK_WORKLIST_VIEWS.map((key) => [key, Number(countsValue[key]) || 0])) as TaskWorklistCounts
  const hasMore = result.hasMore === true
  const total = Math.max(0, Number(result.total) || 0)
  return {
    items: parsedItems,
    counts,
    pageInfo: {
      limit,
      total,
      hasMore,
      nextCursor: hasMore && parsedItems.length ? nextCursorFor(parsedItems[parsedItems.length - 1], sort) : null,
    },
    serverNow: now.toISOString(),
  }
}
