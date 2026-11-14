import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import {
  eachCalendarDate,
  mapCallingReportRow,
  type MojoCallFact,
} from './mojo-call-ledger'

/**
 * First day the per-dial ledger missed. The scheduled ingest walks forward
 * from here until it reaches today, one day at a time, then keeps today fresh.
 */
export const MOJO_DIAL_INGEST_START = '2026-10-28'
export const MOJO_DIAL_STALE_MS = 24 * 60 * 60 * 1000
export const MOJO_DIAL_AGENT_KEY = 'mojo'
export const MOJO_DIAL_BATCH_LIMIT = 100

const EVENT_OUTCOMES = [
  'callback_scheduled',
  'meaningful_conversation',
  'appointment_set',
  'not_interested',
  'wrong_number',
  'disconnected',
  'no_answer',
  'voicemail_left',
  'dnc',
  'already_sold',
  'listed',
  'busy',
  'other',
] as const

export type MojoEventOutcome = (typeof EVENT_OUTCOMES)[number]

/** Prospect-phone stamps. Null means "mark attempted" and leave the stamp alone. */
export type MojoPhoneDisposition =
  | 'dnc'
  | 'wrong_number'
  | 'disconnected'
  | 'no_answer'
  | 'left_voicemail'
  | 'busy'

export type MojoDialCapture = {
  fact: MojoCallFact
  dialedPhone: string | null
  agentName: string | null
}

export type MojoDialWrite = MojoCallFact & {
  normalized_phone: string | null
  outcome: MojoEventOutcome
  phone_disposition: MojoPhoneDisposition | null
  agent_name: string | null
}

const DATE = /^\d{4}-\d{2}-\d{2}$/

export function addCalendarDays(date: string, days: number): string {
  if (!DATE.test(date)) throw new Error('invalid_mojo_call_window')
  const cursor = new Date(`${date}T00:00:00Z`)
  cursor.setUTCDate(cursor.getUTCDate() + days)
  return cursor.toISOString().slice(0, 10)
}

export function centralDateKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? ''
  return `${value('year')}-${value('month')}-${value('day')}`
}

export type MojoDialWindow = {
  from: string
  to: string
  catchingUp: boolean
  nextCursor: string
}

/**
 * Scheduled runs walk one missed day at a time from 2026-10-28.
 * Once the cursor is today, each run re-reads yesterday and today so a
 * disposition edited after the first pass still lands. Explicit from/to
 * replays a closed range of at most two days and only advances the cursor
 * when it continues the saved catch-up, so a one-off replay cannot skip days.
 */
export function mojoDialIngestWindow(options: {
  cursor: string | null
  today: string
  from?: string | null
  to?: string | null
}): MojoDialWindow {
  const today = requiredDate(options.today)
  const cursor = options.cursor ? requiredDate(options.cursor) : null
  const explicitFrom = options.from?.trim() ? requiredDate(options.from) : null
  const explicitTo = options.to?.trim() ? requiredDate(options.to) : null
  if ((explicitFrom == null) !== (explicitTo == null)) throw new Error('invalid_mojo_call_window')

  if (explicitFrom && explicitTo) {
    if (explicitFrom > explicitTo || explicitTo > today) throw new Error('invalid_mojo_call_window')
    if (eachCalendarDate(explicitFrom, explicitTo).length > 2) throw new Error('mojo_dial_window_too_wide')
    const resume = cursor == null ? MOJO_DIAL_INGEST_START : cursor < MOJO_DIAL_INGEST_START ? MOJO_DIAL_INGEST_START : cursor
    const continues = explicitFrom === resume
    const catchingUp = explicitTo < today
    return {
      from: explicitFrom,
      to: explicitTo,
      catchingUp,
      nextCursor: continues && catchingUp ? addCalendarDays(explicitTo, 1) : continues ? today : resume,
    }
  }

  const resume = cursor == null || cursor < MOJO_DIAL_INGEST_START ? MOJO_DIAL_INGEST_START : cursor
  if (resume < today) {
    return { from: resume, to: resume, catchingUp: true, nextCursor: addCalendarDays(resume, 1) }
  }
  const yesterday = addCalendarDays(today, -1)
  return {
    from: yesterday < MOJO_DIAL_INGEST_START ? MOJO_DIAL_INGEST_START : yesterday,
    to: today,
    catchingUp: false,
    nextCursor: today,
  }
}

export function mojoCallIngestIsStale(lastSuccessAt: string | null, now = new Date()): boolean {
  if (!lastSuccessAt) return true
  const parsed = Date.parse(lastSuccessAt)
  if (!Number.isFinite(parsed)) return true
  return now.getTime() - parsed > MOJO_DIAL_STALE_MS
}

export function mojoCallIngestHealth(options: {
  lastSuccessAt: string | null
  latestCallAt: string | null
  now?: Date
}): {
  status: 'current' | 'stale' | 'unknown'
  stale: boolean
  lastSuccessAt: string | null
  latestCallAt: string | null
  ageHours: number | null
  message: string
} {
  const now = options.now ?? new Date()
  const stale = mojoCallIngestIsStale(options.lastSuccessAt, now)
  const parsed = options.lastSuccessAt ? Date.parse(options.lastSuccessAt) : NaN
  const ageHours = Number.isFinite(parsed) ? Math.floor((now.getTime() - parsed) / (60 * 60 * 1000)) : null
  return {
    status: stale ? 'stale' : 'current',
    stale,
    lastSuccessAt: options.lastSuccessAt,
    latestCallAt: options.latestCallAt,
    ageHours,
    message: stale
      ? ageHours == null
        ? 'Mojo call ingest has never succeeded. Dial outcomes are not flowing into the CRM.'
        : `Mojo call ingest last succeeded ${ageHours} hours ago. Dial outcomes are not flowing into the CRM.`
      : 'Mojo call ingest is current.',
  }
}

export function classifyMojoDialResult(label: string | null, code: number | null): {
  outcome: MojoEventOutcome
  phoneDisposition: MojoPhoneDisposition | null
} {
  const text = (label ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
  if (text) {
    if (/\b(dnc|do not call|take me off|remove me|remove my number)\b/.test(text)) {
      return { outcome: 'dnc', phoneDisposition: 'dnc' }
    }
    if (text.includes('wrong number')) return { outcome: 'wrong_number', phoneDisposition: 'wrong_number' }
    if (text.includes('bad number') || text.includes('disconnected') || text.includes('not in service')) {
      return { outcome: 'disconnected', phoneDisposition: 'disconnected' }
    }
    if (text.includes('voicemail') || text.includes('answering machine')) {
      return { outcome: 'voicemail_left', phoneDisposition: 'left_voicemail' }
    }
    if (text === 'no answer' || text === 'no contact') return { outcome: 'no_answer', phoneDisposition: 'no_answer' }
    if (text === 'busy') return { outcome: 'busy', phoneDisposition: 'busy' }
    if (text.includes('callback')) return { outcome: 'callback_scheduled', phoneDisposition: null }
    if (text.includes('appointment')) return { outcome: 'appointment_set', phoneDisposition: null }
    if (text.includes('not interested')) return { outcome: 'not_interested', phoneDisposition: null }
    if (text === 'contact' || text === 'connected') return { outcome: 'meaningful_conversation', phoneDisposition: null }
    return { outcome: 'other', phoneDisposition: null }
  }
  switch (code) {
    case 1: return { outcome: 'meaningful_conversation', phoneDisposition: null }
    case 2:
    case 11: return { outcome: 'no_answer', phoneDisposition: 'no_answer' }
    case 3:
    case 7: return { outcome: 'disconnected', phoneDisposition: 'disconnected' }
    case 5:
    case 6: return { outcome: 'dnc', phoneDisposition: 'dnc' }
    case 8: return { outcome: 'busy', phoneDisposition: 'busy' }
    case 9:
    case 12: return { outcome: 'voicemail_left', phoneDisposition: 'left_voicemail' }
    default: return { outcome: 'other', phoneDisposition: null }
  }
}

export function mapCallingReportDial(value: unknown, durationSeconds = 0): MojoDialCapture {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid_mojo_call')
  const raw = value as Record<string, unknown>
  const result = textField(raw.result) || textField(raw.result_represent)
  const fact = mapCallingReportRow({ ...raw, result: result || raw.result }, durationSeconds)
  return {
    fact,
    dialedPhone: normalizePhoneToE164(textField(raw.phone_number)),
    agentName: safeAgentName(raw.agent_name),
  }
}

export function dedupeMojoDials(dials: MojoDialCapture[]): MojoDialCapture[] {
  const byId = new Map<string, MojoDialCapture>()
  for (const dial of dials) {
    const current = byId.get(dial.fact.provider_call_id)
    if (!current || dial.fact.duration_seconds >= current.fact.duration_seconds) {
      byId.set(dial.fact.provider_call_id, dial)
    }
  }
  return [...byId.values()].sort((left, right) => left.fact.provider_call_id.localeCompare(right.fact.provider_call_id, 'en', { numeric: true }))
}

export function mojoDialWrite(dial: MojoDialCapture): MojoDialWrite {
  const classified = classifyMojoDialResult(dial.fact.result_label, dial.fact.result_code)
  const phone = dial.dialedPhone && /^\+1\d{10}$/.test(dial.dialedPhone) ? dial.dialedPhone : null
  return {
    ...dial.fact,
    normalized_phone: phone,
    outcome: classified.outcome,
    phone_disposition: classified.phoneDisposition,
    agent_name: dial.agentName,
  }
}

export function chunkMojoDials<T>(rows: T[], size = MOJO_DIAL_BATCH_LIMIT): T[][] {
  if (size < 1 || size > MOJO_DIAL_BATCH_LIMIT) throw new Error('mojo_dial_batch_too_large')
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

function requiredDate(value: string): string {
  const date = value.trim()
  if (!DATE.test(date)) throw new Error('invalid_mojo_call_window')
  return date
}

function textField(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function safeAgentName(value: unknown): string | null {
  const text = textField(value).slice(0, 160)
  if (!text || /\d{7}/.test(text)) return null
  return text
}

export function isMojoEventOutcome(value: string): value is MojoEventOutcome {
  return (EVENT_OUTCOMES as readonly string[]).includes(value)
}
