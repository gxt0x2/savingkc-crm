import { normalizePhoneToE164 } from '@/lib/phone-normalize'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export const CONVERSATION_DEFAULT_PAGE_SIZE = 50
export const CONVERSATION_MAX_PAGE_SIZE = 100

export type ConversationQueue = 'needs_reply' | 'mine' | 'unassigned' | 'all'
export type ConversationChannel = 'call' | 'sms' | 'email' | 'voicemail'

export interface ThreadCursor {
  v: 1
  rank: number
  at: string
  key: string
}

export interface TimelineCursor {
  v: 1
  at: string
  id: string
}

export class ConversationReadModelInputError extends Error {
  readonly status = 400
  constructor(message: string) {
    super(message)
    this.name = 'ConversationReadModelInputError'
  }
}

export class ConversationReadModelUnavailableError extends Error {
  readonly status = 503
  readonly code = 'CONVERSATION_READ_MODEL_UNAVAILABLE'
  constructor(message = 'Conversation read model is not available yet') {
    super(message)
    this.name = 'ConversationReadModelUnavailableError'
  }
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value)
  return null
}

export function conversationPageLimit(value: unknown): number {
  if (value === null || value === undefined || value === '') return CONVERSATION_DEFAULT_PAGE_SIZE
  const parsed = integer(value)
  if (parsed === null || parsed < 1 || parsed > CONVERSATION_MAX_PAGE_SIZE) {
    throw new ConversationReadModelInputError(`limit must be between 1 and ${CONVERSATION_MAX_PAGE_SIZE}`)
  }
  return parsed
}

export function conversationQueue(value: unknown): ConversationQueue {
  if (value === null || value === undefined || value === '') return 'needs_reply'
  if (value === 'needs_reply' || value === 'mine' || value === 'unassigned' || value === 'all') return value
  throw new ConversationReadModelInputError('queue must be needs_reply, mine, unassigned, or all')
}

export function conversationChannel(value: unknown): ConversationChannel | null {
  if (value === null || value === undefined || value === '' || value === 'all') return null
  if (value === 'call' || value === 'sms' || value === 'email' || value === 'voicemail') return value
  throw new ConversationReadModelInputError('channel must be call, sms, email, voicemail, or all')
}

export function conversationSearchQuery(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') throw new ConversationReadModelInputError('q must be text')
  const rawQuery = value.trim()
  if (!rawQuery) return null
  // The RPC wraps this value in ILIKE wildcards. Strip SQL wildcard/escape
  // characters so a user search stays literal and cannot force a broad scan.
  const query = rawQuery.replace(/[%_\\]/g, ' ').trim().replace(/\s+/g, ' ')
  if (query.length < 3) throw new ConversationReadModelInputError('q must contain at least 3 characters')
  return query.slice(0, 100)
}

function encodeCursor(value: ThreadCursor | TimelineCursor): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url')
}

function cursorJson(value: string): unknown {
  if (!value || value.length > 1024) throw new ConversationReadModelInputError('Invalid cursor')
  try {
    return JSON.parse(Buffer.from(value, 'base64url').toString('utf8'))
  } catch {
    throw new ConversationReadModelInputError('Invalid cursor')
  }
}

export function encodeConversationThreadCursor(value: Omit<ThreadCursor, 'v'>): string {
  return encodeCursor({ v: 1, ...value })
}

export function encodeConversationTimelineCursor(value: Omit<TimelineCursor, 'v'>): string {
  return encodeCursor({ v: 1, ...value })
}

export function decodeConversationThreadCursor(value: string | null | undefined): ThreadCursor | null {
  if (!value) return null
  const parsed = cursorJson(value) as Partial<ThreadCursor>
  if (
    parsed.v !== 1 ||
    !Number.isInteger(parsed.rank) ||
    Number(parsed.rank) < 0 ||
    Number(parsed.rank) > 2 ||
    typeof parsed.at !== 'string' ||
    Number.isNaN(Date.parse(parsed.at)) ||
    typeof parsed.key !== 'string'
  ) {
    throw new ConversationReadModelInputError('Invalid cursor')
  }
  let canonicalKey: string
  try {
    canonicalKey = conversationThreadKey(parsed.key)
  } catch {
    throw new ConversationReadModelInputError('Invalid cursor')
  }
  if (canonicalKey !== parsed.key) throw new ConversationReadModelInputError('Invalid cursor')
  return { v: 1, rank: Number(parsed.rank), at: parsed.at, key: parsed.key }
}

export function decodeConversationTimelineCursor(value: string | null | undefined): TimelineCursor | null {
  if (!value) return null
  const parsed = cursorJson(value) as Partial<TimelineCursor>
  if (
    parsed.v !== 1 ||
    typeof parsed.at !== 'string' ||
    Number.isNaN(Date.parse(parsed.at)) ||
    typeof parsed.id !== 'string' ||
    !UUID_RE.test(parsed.id)
  ) {
    throw new ConversationReadModelInputError('Invalid cursor')
  }
  return { v: 1, at: parsed.at, id: parsed.id }
}

export function conversationThreadKey(threadId: string): string {
  const value = threadId.trim()
  if (!value || value.length > 200) throw new ConversationReadModelInputError('Invalid threadId')
  if (value.startsWith('lead:')) {
    const leadId = value.slice('lead:'.length)
    if (UUID_RE.test(leadId)) return `lead:${leadId}`
    throw new ConversationReadModelInputError('Invalid lead conversation id')
  }
  if (value.startsWith('phone:')) {
    const phone = normalizePhoneToE164(value.slice('phone:'.length))
    if (phone) return `phone:${phone}`
    throw new ConversationReadModelInputError('Invalid phone conversation id')
  }
  if (value.startsWith('activity:') && UUID_RE.test(value.slice('activity:'.length))) return value
  if (value.startsWith('unmatched:')) {
    const unmatched = value.slice('unmatched:'.length)
    if (unmatched.startsWith('activity:') && UUID_RE.test(unmatched.slice('activity:'.length))) return unmatched
    const phone = normalizePhoneToE164(unmatched)
    if (phone) return `phone:${phone}`
    throw new ConversationReadModelInputError('Invalid unmatched conversation id')
  }
  if (UUID_RE.test(value)) return `lead:${value}`
  throw new ConversationReadModelInputError('Invalid threadId')
}
