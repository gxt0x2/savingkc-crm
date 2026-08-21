import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { isAllowedSmsSender, isDialerCallerIdNumber } from '@/lib/twilio-numbers'

export const PROSPECTING_CAMPAIGN_KINDS = ['dialer', 'sms'] as const
export const PROSPECTING_CAMPAIGN_STATUSES = ['draft', 'active', 'paused', 'completed', 'archived'] as const

export type ProspectingCampaignKind = typeof PROSPECTING_CAMPAIGN_KINDS[number]
export type ProspectingCampaignStatus = typeof PROSPECTING_CAMPAIGN_STATUSES[number]

export interface ProspectingCampaignStepInput {
  delayMinutes: number
  bodyTemplate: string
}

export interface CreateProspectingCampaignInput {
  name: string
  kind: ProspectingCampaignKind
  callerId: string | null
  fromPhone: string | null
  defaultTimezone: string
  perHour: number
  perDay: number
  steps: ProspectingCampaignStepInput[]
}

export interface ProspectingCampaignSummary {
  id: string
  name: string
  kind: ProspectingCampaignKind
  status: ProspectingCampaignStatus
  ownerEmail: string
  ownerName: string
  callerId: string | null
  fromPhone: string | null
  defaultTimezone: string
  perHour: number
  perDay: number
  createdAt: string
  updatedAt: string
  activatedAt: string | null
  pausedAt: string | null
  completedAt: string | null
}

export interface ProspectingCampaignStep {
  id: string
  position: number
  delayMinutes: number
  bodyTemplate: string
}

export interface ProspectingCampaignMember {
  id: string
  leadId: string
  phone: string
  timezone: string
  status: 'active' | 'suppressed' | 'replied' | 'completed' | 'removed'
  suppressionReason: string | null
  currentStepPosition: number
  nextActionAt: string | null
  enrolledAt: string
  lead: {
    fullName: string | null
    propertyAddress: string | null
    station: string | null
    classification: string | null
  } | null
}

export interface ProspectingCampaignMemberPage {
  items: ProspectingCampaignMember[]
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }
}

export interface ProspectingCampaignDetail extends ProspectingCampaignSummary {
  steps: ProspectingCampaignStep[]
  members: ProspectingCampaignMember[]
  stats: {
    total: number
    active: number
    suppressed: number
    replied: number
    completed: number
    sent: number
    failed: number
  }
}

export interface ProspectingCampaignActivity {
  id: string
  eventType: string
  actor: string
  memberId: string | null
  actionId: string | null
  status: 'queued' | 'processing' | 'sent' | 'delivered' | 'replied' | 'blocked' | 'failed' | 'cancelled' | null
  sellerName: string | null
  phone: string | null
  propertyAddress: string | null
  body: string | null
  errorCode: string | null
  providerSid: string | null
  occurredAt: string
  scheduledAt: string | null
  sentAt: string | null
}

export interface ProspectingCampaignActivityPage {
  items: ProspectingCampaignActivity[]
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null }
}

export class ProspectingCampaignInputError extends Error {
  constructor(public code: string, message: string) {
    super(message)
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function integer(value: unknown, fallback: number): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) ? parsed : fallback
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

export function parseCreateProspectingCampaignInput(value: unknown): CreateProspectingCampaignInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ProspectingCampaignInputError('invalid_campaign', 'Campaign details are required')
  }
  const row = value as Record<string, unknown>
  const name = text(row.name)
  const kind = text(row.kind)
  const defaultTimezone = text(row.defaultTimezone) || 'America/Chicago'
  const callerId = normalizePhoneToE164(text(row.callerId))
  const fromPhone = normalizePhoneToE164(text(row.fromPhone))
  const perHour = integer(row.perHour, 150)
  const perDay = integer(row.perDay, 1000)

  if (name.length < 1 || name.length > 120) {
    throw new ProspectingCampaignInputError('invalid_name', 'Campaign name must be between 1 and 120 characters')
  }
  if (!PROSPECTING_CAMPAIGN_KINDS.includes(kind as ProspectingCampaignKind)) {
    throw new ProspectingCampaignInputError('invalid_kind', 'Choose a dialer or SMS campaign')
  }
  if (!isValidTimeZone(defaultTimezone)) {
    throw new ProspectingCampaignInputError('invalid_timezone', 'Choose a valid campaign timezone')
  }
  if (perHour < 1 || perHour > 5000 || perDay < 1 || perDay > 50000 || perDay < perHour) {
    throw new ProspectingCampaignInputError('invalid_pacing', 'Campaign pacing limits are invalid')
  }
  if (kind === 'dialer' && (!callerId || !isDialerCallerIdNumber(callerId))) {
    throw new ProspectingCampaignInputError('caller_id_required', 'Choose an approved calling number')
  }
  if (kind === 'sms' && (!fromPhone || !isAllowedSmsSender(fromPhone, 'broadcast'))) {
    throw new ProspectingCampaignInputError('from_phone_required', 'Choose an approved texting number')
  }

  const rawSteps = Array.isArray(row.steps) ? row.steps : []
  if (kind === 'dialer' && rawSteps.length > 0) {
    throw new ProspectingCampaignInputError('invalid_steps', 'Dialer campaigns do not use automated message steps')
  }
  if (kind === 'sms' && (rawSteps.length < 1 || rawSteps.length > 12)) {
    throw new ProspectingCampaignInputError('invalid_steps', 'SMS campaigns require between 1 and 12 steps')
  }
  const steps = rawSteps.map((rawStep, index) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) {
      throw new ProspectingCampaignInputError('invalid_step', `Step ${index + 1} is invalid`)
    }
    const step = rawStep as Record<string, unknown>
    const delayMinutes = integer(step.delayMinutes, 0)
    const bodyTemplate = text(step.bodyTemplate)
    if (delayMinutes < 0 || delayMinutes > 43200) {
      throw new ProspectingCampaignInputError('invalid_step_delay', `Step ${index + 1} delay must be between 0 and 30 days`)
    }
    if (bodyTemplate.length < 1 || bodyTemplate.length > 1400) {
      throw new ProspectingCampaignInputError('invalid_step_body', `Step ${index + 1} message must be between 1 and 1,400 characters`)
    }
    return { delayMinutes, bodyTemplate }
  })

  return {
    name,
    kind: kind as ProspectingCampaignKind,
    callerId: kind === 'dialer' ? callerId : null,
    fromPhone: kind === 'sms' ? fromPhone : null,
    defaultTimezone,
    perHour,
    perDay,
    steps,
  }
}

export function renderProspectingTemplate(
  body: string,
  values: { fullName?: string | null; propertyAddress?: string | null; agentName: string },
): string | null {
  const fullName = values.fullName?.trim() || 'there'
  const firstName = fullName.split(/\s+/)[0] || 'there'
  const propertyAddress = values.propertyAddress?.trim() || 'your property'
  const replacements: Array<[RegExp, string]> = [
    [/\{\{\s*first_name\s*\}\}/gi, firstName],
    [/\{\{\s*full_name\s*\}\}/gi, fullName],
    [/\{\{\s*property_address\s*\}\}/gi, propertyAddress],
    [/\{\{\s*agent_name\s*\}\}/gi, values.agentName],
    [/\{firstName\}/g, firstName],
    [/\{fullName\}/g, fullName],
    [/\{propertyAddress\}/g, propertyAddress],
    [/\{agentName\}/g, values.agentName],
  ]
  let rendered = body
  for (const [pattern, replacement] of replacements) rendered = rendered.replace(pattern, replacement)
  rendered = rendered.trim()
  if (!rendered || /\{\{[^{}]+\}\}|\{[a-zA-Z][^{}]*\}/.test(rendered)) return null
  return rendered
}

export function parseLeadIds(value: unknown, maximum = 1000): string[] {
  if (!Array.isArray(value)) throw new ProspectingCampaignInputError('invalid_members', 'Choose at least one contact')
  const ids = Array.from(new Set(value.flatMap((item) => typeof item === 'string' && /^[0-9a-f-]{36}$/i.test(item.trim()) ? [item.trim()] : [])))
  if (ids.length < 1 || ids.length > maximum || ids.length !== value.length) {
    throw new ProspectingCampaignInputError('invalid_members', `Choose between 1 and ${maximum} valid contacts`)
  }
  return ids
}

type CampaignWindow = {
  timezone: string
  sendWindowStart: string
  sendWindowEnd: string
  sendDays: number[]
}

type LocalClock = { weekday: number; minutes: number }

function localClock(now: Date, timeZone: string): LocalClock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now)
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(lookup.weekday)
  return { weekday, minutes: Number(lookup.hour) * 60 + Number(lookup.minute) }
}

function timeMinutes(value: string): number {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

export function isWithinProspectingWindow(now: Date, window: CampaignWindow): boolean {
  if (!isValidTimeZone(window.timezone)) return false
  const clock = localClock(now, window.timezone)
  return window.sendDays.includes(clock.weekday)
    && clock.minutes >= timeMinutes(window.sendWindowStart)
    && clock.minutes < timeMinutes(window.sendWindowEnd)
}

export function nextProspectingWindow(now: Date, window: CampaignWindow): Date {
  const candidate = new Date(now)
  candidate.setUTCMinutes(candidate.getUTCMinutes() + 1, 0, 0)
  const maximum = 8 * 24 * 60
  for (let offset = 0; offset < maximum; offset += 1) {
    if (isWithinProspectingWindow(candidate, window)) return candidate
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1)
  }
  return new Date(now.getTime() + 24 * 60 * 60 * 1000)
}
