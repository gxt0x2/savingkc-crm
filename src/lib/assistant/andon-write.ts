import { ANDON_STATUSES, type AndonStatus } from '@/lib/andon'
import type { AssistantActor } from '@/lib/assistant/auth'

type JsonRecord = Record<string, unknown>
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any }

export const ANDON_WRITE_ACTIONS = [
  'list_open_andons',
  'get_andon',
  'update_andon_status',
  'set_andon_assignee',
  'add_andon_note',
  'set_andon_chat_thread',
  'link_andon_record',
] as const

export type AndonWriteAction = (typeof ANDON_WRITE_ACTIONS)[number]
export const ASSISTANT_WRITE_SCOPE = 'ops_except_money' as const
export const OPEN_ANDON_STATUSES = ['open', 'acknowledged', 'in_progress', 'testing'] as const
export const ANDON_TABLE = 'feedback_submissions'
const ANDON_SELECT = 'id, type, issue_kind, section, department, category, description, five_whys, priority, status, assignee, notes, agent_name, page_url, record_id, record_type, record_url, chat_space_id, chat_thread_id, estimated_resolution_at, created_at, updated_at, resolved_at'

export type AndonNote = {
  id: string
  body: string
  author_email: string
  author_name: string
  created_at: string
}

export function andonShortId(id: string): string {
  return id.replace(/-/g, '').slice(0, 8)
}

export function andonCrmUrl(issueId?: string): string {
  const origin = (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/+$/, '')
  const url = `${origin}/reports/andon`
  return issueId ? `${url}?andon=${encodeURIComponent(issueId)}` : url
}

export function andonChatTitle(department: string, category: string, id: string): string {
  return `Andon · ${department} · ${category} · ${andonShortId(id)}`
}

export function andonChatThreadKey(id: string): string {
  return `andon-${id}`
}

export function parseAndonNotes(value: unknown): AndonNote[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const note = item as JsonRecord
    const body = typeof note.body === 'string' ? note.body.trim() : ''
    if (!body) return []
    return [{
      id: typeof note.id === 'string' && note.id ? note.id : crypto.randomUUID(),
      body: body.slice(0, 4000),
      author_email: typeof note.author_email === 'string' ? note.author_email : '',
      author_name: typeof note.author_name === 'string' ? note.author_name : '',
      created_at: typeof note.created_at === 'string' ? note.created_at : new Date().toISOString(),
    }]
  })
}

export function presentAndon(row: JsonRecord) {
  const id = String(row.id || '')
  const department = String(row.department || '').trim()
  const category = String(row.category || '').trim()
  const chatSpaceId = typeof row.chat_space_id === 'string' && row.chat_space_id.trim() ? row.chat_space_id.trim() : null
  const chatThreadId = typeof row.chat_thread_id === 'string' && row.chat_thread_id.trim() ? row.chat_thread_id.trim() : null
  const spaceHint = chatSpaceId || process.env.CHAT_ANDON_SPACE?.trim() || null
  return {
    id,
    issueKind: row.issue_kind ?? null,
    department,
    category,
    section: row.section ?? null,
    description: row.description ?? null,
    fiveWhys: Array.isArray(row.five_whys) ? row.five_whys : [],
    priority: row.priority ?? null,
    status: row.status ?? null,
    assignee: row.assignee ?? null,
    notes: parseAndonNotes(row.notes),
    raisedBy: row.agent_name ?? null,
    recordId: row.record_id ?? null,
    recordType: row.record_type ?? null,
    recordUrl: row.record_url ?? null,
    chatSpaceId,
    chatThreadId,
    estimatedResolutionAt: row.estimated_resolution_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
    resolvedAt: row.resolved_at ?? null,
    crmUrl: andonCrmUrl(id),
    chatNomination: {
      title: andonChatTitle(department || 'Unassigned', category || 'General', id),
      crmUrl: andonCrmUrl(id),
      threadKey: andonChatThreadKey(id),
      spaceHint,
      needsThread: !chatThreadId,
    },
  }
}

function throwQuery(error: { message?: string; code?: string } | null, fallback: string) {
  if (!error) return
  throw new Error(error.message || fallback)
}

async function readAndon(db: Db, andonId: string) {
  const { data, error } = await db.from(ANDON_TABLE).select(ANDON_SELECT).eq('id', andonId).maybeSingle()
  throwQuery(error, 'Andon lookup failed')
  if (!data) throw new Error('Andon not found')
  return data
}

export async function listOpenAndons(db: Db, limit = 25) {
  const bounded = Math.min(Math.max(limit, 1), 50)
  const { data, error } = await db
    .from(ANDON_TABLE)
    .select(ANDON_SELECT)
    .in('status', [...OPEN_ANDON_STATUSES])
    .order('created_at', { ascending: false })
  throwQuery(error, 'Open Andon lookup failed')
  const andons = (data || []).slice(0, bounded).map(presentAndon)
  return { action: 'list_open_andons' as const, writeScope: ASSISTANT_WRITE_SCOPE, andons }
}

export async function getAndon(db: Db, andonId: string) {
  return { action: 'get_andon' as const, writeScope: ASSISTANT_WRITE_SCOPE, andon: presentAndon(await readAndon(db, andonId)) }
}

export async function updateAndonStatus(db: Db, andonId: string, status: AndonStatus) {
  if (!(ANDON_STATUSES as readonly string[]).includes(status)) throw new Error('Invalid Andon status')
  const current = await readAndon(db, andonId)
  const resolved = status === 'resolved' || status === 'closed'
  const { error } = await db.from(ANDON_TABLE).update({
    status,
    resolved_at: resolved ? new Date().toISOString() : null,
  }).eq('id', andonId)
  throwQuery(error, 'Andon status update failed')
  return {
    action: 'update_andon_status' as const,
    writeScope: ASSISTANT_WRITE_SCOPE,
    andon: presentAndon({ ...current, status, resolved_at: resolved ? new Date().toISOString() : null }),
  }
}

export async function setAndonAssignee(db: Db, andonId: string, assignee: string | null) {
  const current = await readAndon(db, andonId)
  const nextAssignee = assignee?.trim().slice(0, 120) || null
  const { error } = await db.from(ANDON_TABLE).update({ assignee: nextAssignee }).eq('id', andonId)
  throwQuery(error, 'Andon assignee update failed')
  return {
    action: 'set_andon_assignee' as const,
    writeScope: ASSISTANT_WRITE_SCOPE,
    andon: presentAndon({ ...current, assignee: nextAssignee }),
  }
}

export async function addAndonNote(db: Db, actor: AssistantActor, andonId: string, note: string) {
  const body = note.trim().slice(0, 4000)
  if (!body) throw new Error('Andon note is required')
  const current = await readAndon(db, andonId)
  const nextNote: AndonNote = {
    id: crypto.randomUUID(),
    body,
    author_email: actor.email,
    author_name: actor.fullName,
    created_at: new Date().toISOString(),
  }
  const notes = [...parseAndonNotes(current.notes), nextNote]
  const { error } = await db.from(ANDON_TABLE).update({ notes }).eq('id', andonId)
  throwQuery(error, 'Andon note update failed')
  return {
    action: 'add_andon_note' as const,
    writeScope: ASSISTANT_WRITE_SCOPE,
    note: nextNote,
    andon: presentAndon({ ...current, notes }),
  }
}

export async function setAndonChatThread(db: Db, andonId: string, input: {
  chatSpaceId?: string | null
  chatThreadId?: string | null
}) {
  const current = await readAndon(db, andonId)
  const chatSpaceId = input.chatSpaceId === undefined
    ? current.chat_space_id
    : (typeof input.chatSpaceId === 'string' && input.chatSpaceId.trim() ? input.chatSpaceId.trim().slice(0, 200) : null)
  const chatThreadId = input.chatThreadId === undefined
    ? current.chat_thread_id
    : (typeof input.chatThreadId === 'string' && input.chatThreadId.trim() ? input.chatThreadId.trim().slice(0, 200) : null)
  const { error } = await db.from(ANDON_TABLE).update({
    chat_space_id: chatSpaceId,
    chat_thread_id: chatThreadId,
  }).eq('id', andonId)
  throwQuery(error, 'Andon Chat thread update failed')
  return {
    action: 'set_andon_chat_thread' as const,
    writeScope: ASSISTANT_WRITE_SCOPE,
    andon: presentAndon({ ...current, chat_space_id: chatSpaceId, chat_thread_id: chatThreadId }),
  }
}

export async function linkAndonRecord(db: Db, andonId: string, input: {
  recordId: string
  recordType: 'lead' | 'property'
  recordUrl?: string | null
}) {
  const current = await readAndon(db, andonId)
  const recordId = input.recordId.trim().slice(0, 200)
  const recordUrl = input.recordUrl?.trim().slice(0, 1000)
    || (input.recordType === 'lead'
      ? `${(process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/+$/, '')}/leads/${encodeURIComponent(recordId)}`
      : `${(process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/+$/, '')}/deals/${encodeURIComponent(recordId)}`)
  const { error } = await db.from(ANDON_TABLE).update({
    record_id: recordId,
    record_type: input.recordType,
    record_url: recordUrl,
  }).eq('id', andonId)
  throwQuery(error, 'Andon record link update failed')
  return {
    action: 'link_andon_record' as const,
    writeScope: ASSISTANT_WRITE_SCOPE,
    andon: presentAndon({ ...current, record_id: recordId, record_type: input.recordType, record_url: recordUrl }),
  }
}
