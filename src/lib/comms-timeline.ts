// Communication Hub — one normalized timeline across every channel.
//
// The CRM logs every touch into `lead_activities` (calls, SMS in/out, email,
// voicemail, letters) with channel-specific metadata. Agents had no single
// place to see "who did we contact, how, when, and what happened." This module
// normalizes a raw activity row into one consistent CommEvent so the dialer (and
// later, a dedicated hub view) can render who/how/when/outcome the same way for
// every channel.

import { dispositionLabel, getDisposition } from '@/lib/dialer-dispositions'

export type CommChannel = 'call' | 'sms' | 'email' | 'voicemail' | 'letter'
export type CommDirection = 'inbound' | 'outbound'
export type OutcomeTone = 'positive' | 'neutral' | 'negative'

export interface RawActivity {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export interface CommEvent {
  id: string
  channel: CommChannel
  direction: CommDirection
  agent: string | null
  at: string
  /** Short headline, e.g. "Call · outbound" or "SMS received". */
  title: string
  /** Who/where — formatted phone or address line. */
  contact: string | null
  /** Disposition / result label, when the channel has one. */
  outcome: string | null
  outcomeTone: OutcomeTone
  durationSec: number | null
  /** Message/voicemail/notes body, when present. */
  body: string | null
}

const CHANNEL_BY_TYPE: Record<string, CommChannel> = {
  call: 'call',
  voicemail: 'voicemail',
  email: 'email',
  letter_tracking: 'letter',
  sms: 'sms',
  sms_sent: 'sms',
  sms_received: 'sms',
  sms_inbound: 'sms',
  sms_outbound: 'sms',
}

/** Channels that represent an actual contact attempt (what the hub surfaces). */
export function isCommActivity(activityType: string): boolean {
  return activityType in CHANNEL_BY_TYPE
}

function resolveDirection(activityType: string, md: Record<string, unknown>): CommDirection {
  const raw = typeof md.direction === 'string' ? md.direction.toLowerCase() : ''
  if (raw === 'inbound' || raw === 'in' || raw === 'received') return 'inbound'
  if (raw === 'outbound' || raw === 'out' || raw === 'sent') return 'outbound'
  if (activityType === 'sms_received' || activityType === 'sms_inbound') return 'inbound'
  // Calls/voicemail/email/letters from this CRM are outbound unless told otherwise.
  return 'outbound'
}

function outcomeToneOf(disposition: string | null): OutcomeTone {
  const def = getDisposition(disposition)
  if (!def) return 'neutral'
  if (def.dead || def.dnc || def.stopsNumber) return 'negative'
  if (def.reached) return 'positive'
  return 'neutral'
}

function num(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

/** Normalize one lead_activities row into a CommEvent, or null if not a comm. */
export function normalizeActivity(activity: RawActivity): CommEvent | null {
  const channel = CHANNEL_BY_TYPE[activity.activity_type]
  if (!channel) return null

  const md = (activity.metadata ?? {}) as Record<string, unknown>
  const direction = resolveDirection(activity.activity_type, md)
  const disposition = str(md.disposition)
  const outcome = channel === 'call' || channel === 'voicemail'
    ? (disposition ? dispositionLabel(disposition) : null)
    : null

  const contact = str(md.to) ?? str(md.from) ?? str(md.phone) ?? str(md.address) ?? null
  const body = str(md.body) ?? str(md.message) ?? str(md.notes) ?? null

  const heir = str(md.heir_name)
  const channelLabel = channel === 'sms' ? 'SMS'
    : channel === 'voicemail' ? 'Voicemail'
    : channel === 'email' ? 'Email'
    : channel === 'letter' ? 'Letter'
    : 'Call'
  const dirLabel = direction === 'inbound' ? 'received' : 'sent'
  const title = channel === 'call'
    ? (direction === 'inbound' ? 'Inbound call' : 'Outbound call')
    : `${channelLabel} ${dirLabel}`

  return {
    id: activity.id,
    channel,
    direction,
    agent: str(activity.agent),
    at: activity.created_at,
    title: heir ? `${title} · ${heir}` : title,
    contact,
    outcome,
    outcomeTone: outcomeToneOf(disposition),
    durationSec: num(md.duration) ?? num(md.duration_seconds),
    body,
  }
}

/** Normalize + sort newest-first, dropping non-comm rows. */
export function buildCommsTimeline(activities: RawActivity[]): CommEvent[] {
  return activities
    .map(normalizeActivity)
    .filter((e): e is CommEvent => e !== null)
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}

export interface CommsSummary {
  total: number
  calls: number
  sms: number
  emails: number
  voicemails: number
  lastContactAt: string | null
  /** Last time we actually reached the person (positive call outcome). */
  lastReachedAt: string | null
}

export function summarizeComms(events: CommEvent[]): CommsSummary {
  let calls = 0, sms = 0, emails = 0, voicemails = 0
  let lastContactAt: string | null = null
  let lastReachedAt: string | null = null
  for (const e of events) {
    if (e.channel === 'call') calls++
    else if (e.channel === 'sms') sms++
    else if (e.channel === 'email') emails++
    else if (e.channel === 'voicemail') voicemails++
    if (!lastContactAt || new Date(e.at) > new Date(lastContactAt)) lastContactAt = e.at
    if (e.outcomeTone === 'positive' && (!lastReachedAt || new Date(e.at) > new Date(lastReachedAt))) lastReachedAt = e.at
  }
  return { total: events.length, calls, sms, emails, voicemails, lastContactAt, lastReachedAt }
}
