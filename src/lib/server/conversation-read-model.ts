import {
  type ConversationHubActivity,
  type ConversationHubLead,
  type ConversationHubThread,
} from '@/lib/operating-model/conversation-hub'
import {
  communicationActivitySummary,
  getCallOutcomePresentation,
  getConversationDirection,
} from '@/lib/operating-model/conversation-presentation'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  CONVERSATION_MAX_PAGE_SIZE,
  ConversationReadModelInputError,
  ConversationReadModelUnavailableError,
  conversationPageLimit,
  conversationQueue,
  conversationSearchQuery,
  conversationThreadKey,
  decodeConversationThreadCursor,
  decodeConversationTimelineCursor,
  encodeConversationThreadCursor,
  encodeConversationTimelineCursor,
  type ConversationChannel,
  type ConversationQueue,
} from './conversation-read-model-contract'

export {
  CONVERSATION_DEFAULT_PAGE_SIZE,
  CONVERSATION_MAX_PAGE_SIZE,
  ConversationReadModelInputError,
  ConversationReadModelUnavailableError,
  conversationChannel,
  conversationPageLimit,
  conversationQueue,
  conversationSearchQuery,
  conversationThreadKey,
  decodeConversationThreadCursor,
  decodeConversationTimelineCursor,
} from './conversation-read-model-contract'
export type { ConversationChannel, ConversationQueue } from './conversation-read-model-contract'

export type ConversationReadSource = 'projection' | 'compatibility'

export interface ConversationThreadItem extends ConversationHubThread {
  threadKey: string
  kind: 'lead' | 'unmatched'
}

export interface ConversationTimelineItem extends ConversationHubActivity {
  type: string
  kind: 'call' | 'message' | 'note' | 'task' | 'status'
  channel: ConversationChannel | null
  direction: 'inbound' | 'outbound' | null
}

export interface ConversationPageInfo {
  limit: number
  hasMore: boolean
  nextCursor: string | null
}

export interface ConversationThreadPage {
  items: ConversationThreadItem[]
  /** @deprecated Unmatched callers are first-class items in `items`. */
  unmatchedActivities: []
  pageInfo: ConversationPageInfo
  source: ConversationReadSource
  degraded: boolean
  warning?: string
}

export interface ConversationTimelinePage {
  threadId: string
  threadKey: string
  items: ConversationTimelineItem[]
  pageInfo: ConversationPageInfo
  source: ConversationReadSource
  degraded: boolean
  warning?: string
}

export interface ConversationAttentionSummary {
  needsReply: number
  calls: number
  emails: number
  texts: number
  overdue: number
  source: 'projection'
  degraded: false
}

export interface ReadConversationThreadsInput {
  limit?: number
  cursor?: string | null
  queue?: ConversationQueue
  actorName?: string | null
  channel?: ConversationChannel | null
  query?: string | null
}

export interface ReadConversationTimelineInput {
  threadId: string
  limit?: number
  cursor?: string | null
}

interface ConversationProjectionRow {
  thread_key: string
  lead_id: string | null
  phone: string | null
  attention_state: string
  attention_rank: number
  owner: string | null
  last_channel: string | null
  last_direction: string | null
  last_communication_id: string
  last_communication_type: string
  last_communication_description: string | null
  last_communication_agent: string | null
  last_communication_metadata: Record<string, unknown> | null
  last_communication_at: string
  last_activity_at: string
  primary_next_action_id: string | null
  primary_next_action_title: string | null
  primary_next_action_due_at: string | null
  primary_next_action_owner: string | null
}

type ConversationDatabase = ReturnType<typeof supabaseAdmin>


function errorCode(error: unknown): string {
  if (!error || typeof error !== 'object') return ''
  return typeof (error as { code?: unknown }).code === 'string' ? (error as { code: string }).code : ''
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (!error || typeof error !== 'object') return ''
  return typeof (error as { message?: unknown }).message === 'string' ? (error as { message: string }).message : ''
}

export function isConversationReadModelMissing(error: unknown): boolean {
  const code = errorCode(error)
  const message = errorMessage(error)
  return ['42P01', '42883', 'PGRST202', 'PGRST205'].includes(code) ||
    /conversation_(thread_page|timeline_page|attention_summary)_v1.*(not find|does not exist)/i.test(message) ||
    /conversation_thread_state.*does not exist/i.test(message)
}

function throwDatabaseError(error: unknown, fallback: string): never {
  throw new Error(errorMessage(error) || fallback)
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function attentionState(value: unknown): ConversationThreadItem['attentionState'] {
  if (value === 'needs_reply' || value === 'waiting_on_contact') return value
  return 'resolved'
}

function channel(value: unknown): ConversationThreadItem['lastChannel'] {
  if (value === 'call' || value === 'sms' || value === 'email' || value === 'voicemail') return value
  return null
}

async function fetchLeadContext(
  db: ConversationDatabase,
  leadIds: string[],
): Promise<Map<string, ConversationHubLead>> {
  if (leadIds.length === 0) return new Map()

  const uniqueIds = [...new Set(leadIds)].slice(0, CONVERSATION_MAX_PAGE_SIZE)
  const leadResult = await db
    .from('leads')
    .select('id, full_name, phone, email, property_address, city, county, station, priority, assigned_agent, classification, dead_reason, source, motivation_score, arv, offer_amount, appointment_date, created_at')
    .in('id', uniqueIds)
    .limit(CONVERSATION_MAX_PAGE_SIZE)

  if (leadResult.error) throwDatabaseError(leadResult.error, 'Conversation contacts could not be loaded')

  const leads = new Map<string, ConversationHubLead>()
  for (const row of (leadResult.data ?? []) as ConversationHubLead[]) {
    leads.set(row.id, row)
  }
  return leads
}

function unmatchedLead(row: ConversationProjectionRow): ConversationHubLead {
  const phone = text(row.phone)
  return {
    id: publicThreadId(row.thread_key, null),
    full_name: phone ?? 'Unknown caller',
    phone,
    email: null,
    property_address: null,
    city: null,
    county: null,
    station: 'unmatched',
    priority: 'normal',
    assigned_agent: null,
    classification: null,
    dead_reason: null,
    source: 'unmatched_activity',
    motivation_score: null,
    arv: null,
    offer_amount: null,
    appointment_date: null,
    created_at: row.last_communication_at,
  }
}

function publicThreadId(threadKey: string, leadId: string | null): string {
  if (leadId) return leadId
  if (threadKey.startsWith('phone:')) return `unmatched:${threadKey.slice('phone:'.length)}`
  return `unmatched:${threadKey}`
}

function projectionThread(
  row: ConversationProjectionRow,
  lead: ConversationHubLead | undefined,
  now: Date,
): ConversationThreadItem {
  const state = attentionState(row.attention_state)
  const communication: ConversationHubActivity = {
    id: row.last_communication_id,
    lead_id: row.lead_id,
    activity_type: row.last_communication_type,
    description: row.last_communication_description,
    agent: row.last_communication_agent,
    metadata: row.last_communication_metadata ?? {},
    created_at: row.last_communication_at,
  }
  const base = lead ?? unmatchedLead(row)
  const dueAt = text(row.primary_next_action_due_at)
  const lastChannel = channel(row.last_channel)

  return {
    ...base,
    id: publicThreadId(row.thread_key, row.lead_id),
    threadKey: row.thread_key,
    kind: row.lead_id ? 'lead' : 'unmatched',
    attentionState: state,
    unread: state === 'needs_reply',
    owner: text(row.owner) ?? text(base.assigned_agent),
    lastMessage: communicationActivitySummary(communication),
    lastActivityAt: row.last_activity_at,
    lastChannel,
    lastCallOutcome: lastChannel === 'call' || lastChannel === 'voicemail'
      ? getCallOutcomePresentation(communication)
      : null,
    primaryNextAction: row.primary_next_action_id ? {
      id: row.primary_next_action_id,
      title: text(row.primary_next_action_title) ?? 'Next action',
      dueAt,
      owner: text(row.primary_next_action_owner) ?? text(row.owner),
      overdue: Boolean(dueAt && new Date(dueAt) < now),
    } : null,
  }
}

function projectionCursor(row: ConversationProjectionRow): string {
  return encodeConversationThreadCursor({
    rank: row.attention_rank,
    at: row.last_activity_at,
    key: row.thread_key,
  })
}

function timelineCursor(row: ConversationTimelineItem): string {
  return encodeConversationTimelineCursor({ at: row.created_at, id: row.id })
}

export async function readConversationThreads(
  input: ReadConversationThreadsInput = {},
  db: ConversationDatabase = supabaseAdmin(),
): Promise<ConversationThreadPage> {
  const limit = conversationPageLimit(input.limit)
  const queue = conversationQueue(input.queue)
  const query = conversationSearchQuery(input.query)
  const cursor = decodeConversationThreadCursor(input.cursor)
  if (queue === 'mine' && !text(input.actorName)) {
    throw new ConversationReadModelInputError('The mine queue requires an authenticated actor')
  }

  const { data, error } = await db.rpc('conversation_thread_page_v1', {
    page_limit: limit + 1,
    page_queue: queue,
    page_actor: queue === 'mine' ? text(input.actorName) : null,
    page_channel: input.channel ?? null,
    page_query: query,
    after_attention_rank: cursor?.rank ?? null,
    after_activity_at: cursor?.at ?? null,
    after_thread_key: cursor?.key ?? null,
  })

  if (error) {
    if (isConversationReadModelMissing(error)) throw new ConversationReadModelUnavailableError()
    throwDatabaseError(error, 'Conversation inbox could not be loaded')
  }

  const rows = (data ?? []) as ConversationProjectionRow[]
  const hasMore = rows.length > limit
  const pageRows = rows.slice(0, limit)
  const leads = await fetchLeadContext(
    db,
    pageRows.flatMap((row) => row.lead_id ? [row.lead_id] : []),
  )
  const now = new Date()

  return {
    items: pageRows.map((row) => projectionThread(row, row.lead_id ? leads.get(row.lead_id) : undefined, now)),
    unmatchedActivities: [],
    pageInfo: {
      limit,
      hasMore,
      nextCursor: hasMore && pageRows.length > 0 ? projectionCursor(pageRows[pageRows.length - 1]!) : null,
    },
    source: 'projection',
    degraded: false,
  }
}

function timelineItem(row: ConversationHubActivity): ConversationTimelineItem {
  const activityType = row.activity_type
  const kind: ConversationTimelineItem['kind'] =
    activityType === 'call' || activityType === 'missed_call' || activityType === 'voicemail'
      ? 'call'
      : activityType === 'note' || activityType === 'agent_note'
        ? 'note'
        : activityType === 'task'
          ? 'task'
          : activityType === 'status_change' || activityType === 'letter_tracking'
            ? 'status'
            : 'message'
  const resolvedChannel: ConversationChannel | null = activityType.startsWith('sms')
    ? 'sms'
    : activityType.startsWith('email')
      ? 'email'
      : kind === 'call'
        ? activityType === 'voicemail' ? 'voicemail' : 'call'
        : null
  return {
    ...row,
    type: activityType,
    kind,
    channel: resolvedChannel,
    direction: getConversationDirection(row),
  }
}

export async function readConversationTimeline(
  input: ReadConversationTimelineInput,
  db: ConversationDatabase = supabaseAdmin(),
): Promise<ConversationTimelinePage> {
  const threadId = input.threadId.trim()
  const threadKey = conversationThreadKey(threadId)
  const limit = conversationPageLimit(input.limit)
  const cursor = decodeConversationTimelineCursor(input.cursor)
  const { data, error } = await db.rpc('conversation_timeline_page_v1', {
    target_thread_key: threadKey,
    page_limit: limit + 1,
    before_created_at: cursor?.at ?? null,
    before_activity_id: cursor?.id ?? null,
  })

  if (error) {
    if (isConversationReadModelMissing(error)) throw new ConversationReadModelUnavailableError()
    throwDatabaseError(error, 'Conversation timeline could not be loaded')
  }

  const allRows = (data ?? []) as ConversationHubActivity[]
  const hasMore = allRows.length > limit
  const rows = allRows.slice(0, limit).map(timelineItem)
  return {
    threadId,
    threadKey,
    items: rows,
    pageInfo: {
      limit,
      hasMore,
      nextCursor: hasMore && rows.length > 0 ? timelineCursor(rows[rows.length - 1]!) : null,
    },
    source: 'projection',
    degraded: false,
  }
}

export async function readConversationAttention(
  db: ConversationDatabase = supabaseAdmin(),
): Promise<ConversationAttentionSummary> {
  const { data, error } = await db.rpc('conversation_attention_summary_v1')
  if (error) {
    if (isConversationReadModelMissing(error)) throw new ConversationReadModelUnavailableError()
    throwDatabaseError(error, 'Conversation attention could not be loaded')
  }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row !== 'object') throw new Error('Conversation attention summary returned no data')
  const summary = row as Record<string, unknown>
  return {
    needsReply: Number(summary.needs_reply ?? 0),
    calls: Number(summary.calls ?? 0),
    emails: Number(summary.emails ?? 0),
    texts: Number(summary.texts ?? 0),
    overdue: Number(summary.overdue ?? 0),
    source: 'projection',
    degraded: false,
  }
}
