import { resolveTaskAssignee } from '@/lib/api/task-assignee'
import {
  MOBILE_APPOINTMENT_OUTCOMES,
  MOBILE_APPOINTMENT_TYPES,
  type CreateMobileAppointmentInput,
  type EditMobileAppointmentPatch,
  type MobileAppointmentOutcome,
  type RescheduleMobileAppointmentInput,
} from '@/lib/mobile-api/appointment-contract'

type ParseFailure = { ok: false; error: string; status: 400 | 403 }
type ParseSuccess<T> = { ok: true; value: T }
type ParseResult<T> = ParseSuccess<T> | ParseFailure

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CREATE_KEYS = new Set(['leadId', 'type', 'scheduledAt', 'endsAt', 'title', 'location', 'timeZone', 'assignedTo', 'notes', 'sendReminder'])
const EDIT_KEYS = new Set(['expectedVersion', 'patch'])
const EDIT_PATCH_KEYS = new Set(['title', 'type', 'location', 'scheduledAt', 'endsAt', 'timeZone', 'notes'])
const RESCHEDULE_KEYS = new Set(['scheduledAt', 'endsAt', 'timeZone', 'expectedVersion', 'notes'])
const OUTCOME_KEYS = new Set(['leadId', 'outcome', 'notes', 'expectedVersion'])

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function onlyKeys(value: Record<string, unknown>, allowed: Set<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function cleanText(value: unknown, max: number, required = false): string | null | undefined {
  if (value === undefined) return required ? null : undefined
  if (value === null) return required ? null : null
  if (typeof value !== 'string') return required ? null : undefined
  const text = value.trim()
  if (!text) return required ? null : null
  return text.slice(0, max)
}

function iso(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null
}

function validTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format()
    return true
  } catch {
    return false
  }
}

function validVersion(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0
}

function validateWindow(scheduledAt: string, endsAt: string, now: number): string | null {
  const start = Date.parse(scheduledAt)
  const end = Date.parse(endsAt)
  if (start <= now || start > now + (2 * 365 * 24 * 60 * 60 * 1000)) {
    return 'Choose a future appointment within two years.'
  }
  if (end < start + (15 * 60 * 1000) || end > start + (24 * 60 * 60 * 1000)) {
    return 'Appointment end time must be at least 15 minutes after its start and within 24 hours.'
  }
  return null
}

export function buildMobileAppointmentCreate(
  input: unknown,
  actorName: string,
  now = Date.now(),
): ParseResult<CreateMobileAppointmentInput> {
  if (!isRecord(input) || !onlyKeys(input, CREATE_KEYS)) {
    return { ok: false, error: 'Unsupported appointment fields.', status: 400 }
  }
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : ''
  const title = cleanText(input.title, 200, true)
  const scheduledAt = iso(input.scheduledAt)
  const endsAt = iso(input.endsAt)
  const timeZone = typeof input.timeZone === 'string' ? input.timeZone.trim() : ''
  if (!UUID.test(leadId) || !title || !scheduledAt || !endsAt || !validTimeZone(timeZone)) {
    return { ok: false, error: 'Contact, title, times, and a valid time zone are required.', status: 400 }
  }
  if (!MOBILE_APPOINTMENT_TYPES.includes(input.type as never)) {
    return { ok: false, error: 'Choose a valid appointment type.', status: 400 }
  }
  const timeError = validateWindow(scheduledAt, endsAt, now)
  if (timeError) return { ok: false, error: timeError, status: 400 }
  const location = cleanText(input.location, 500) ?? null
  if (input.type === 'in_person' && !location) {
    return { ok: false, error: 'In-person appointments require a location.', status: 400 }
  }
  const assignment = resolveTaskAssignee(input.assignedTo, actorName, { defaultToActor: true })
  if (!assignment.authorized || !assignment.assignedTo) {
    return { ok: false, error: 'Appointment assignee is not authorized.', status: 403 }
  }
  if (input.sendReminder !== undefined && typeof input.sendReminder !== 'boolean') {
    return { ok: false, error: 'Reminder selection must be true or false.', status: 400 }
  }
  if (input.sendReminder === true) {
    return { ok: false, error: 'Seller reminders are not configured for mobile appointments.', status: 400 }
  }
  return {
    ok: true,
    value: {
      leadId,
      type: input.type as CreateMobileAppointmentInput['type'],
      scheduledAt,
      endsAt,
      title,
      location,
      timeZone,
      assignedTo: assignment.assignedTo,
      notes: cleanText(input.notes, 5_000) ?? null,
      sendReminder: false,
    },
  }
}

export function buildMobileAppointmentEdit(input: unknown): ParseResult<{
  expectedVersion: number
  patch: EditMobileAppointmentPatch
}> {
  if (!isRecord(input) || !onlyKeys(input, EDIT_KEYS) || !validVersion(input.expectedVersion)
      || !isRecord(input.patch) || !onlyKeys(input.patch, EDIT_PATCH_KEYS)
      || Object.keys(input.patch).length === 0) {
    return { ok: false, error: 'A version and supported appointment edit are required.', status: 400 }
  }
  const patch: EditMobileAppointmentPatch = {}
  if ('title' in input.patch) {
    const value = cleanText(input.patch.title, 200, true)
    if (!value) return { ok: false, error: 'Appointment title cannot be empty.', status: 400 }
    patch.title = value
  }
  if ('type' in input.patch) {
    if (!MOBILE_APPOINTMENT_TYPES.includes(input.patch.type as never)) {
      return { ok: false, error: 'Choose a valid appointment type.', status: 400 }
    }
    patch.type = input.patch.type as EditMobileAppointmentPatch['type']
  }
  if ('location' in input.patch) patch.location = cleanText(input.patch.location, 500) ?? null
  if ('notes' in input.patch) patch.notes = cleanText(input.patch.notes, 5_000) ?? null
  if ('scheduledAt' in input.patch) {
    const value = iso(input.patch.scheduledAt)
    if (!value) return { ok: false, error: 'Choose a valid appointment start time.', status: 400 }
    patch.scheduledAt = value
  }
  if ('endsAt' in input.patch) {
    const value = iso(input.patch.endsAt)
    if (!value) return { ok: false, error: 'Choose a valid appointment end time.', status: 400 }
    patch.endsAt = value
  }
  if ('timeZone' in input.patch) {
    if (!validTimeZone(input.patch.timeZone)) return { ok: false, error: 'Choose a valid time zone.', status: 400 }
    patch.timeZone = input.patch.timeZone.trim()
  }
  return { ok: true, value: { expectedVersion: input.expectedVersion, patch } }
}

export function buildMobileAppointmentReschedule(input: unknown, now = Date.now()): ParseResult<{
  expectedVersion: number
  payload: RescheduleMobileAppointmentInput
}> {
  if (!isRecord(input) || !onlyKeys(input, RESCHEDULE_KEYS) || !validVersion(input.expectedVersion)) {
    return { ok: false, error: 'A version and supported reschedule are required.', status: 400 }
  }
  const scheduledAt = iso(input.scheduledAt)
  const endsAt = iso(input.endsAt)
  const timeZone = typeof input.timeZone === 'string' ? input.timeZone.trim() : ''
  if (!scheduledAt || !endsAt || !validTimeZone(timeZone)) {
    return { ok: false, error: 'Valid start, end, and time zone values are required.', status: 400 }
  }
  const timeError = validateWindow(scheduledAt, endsAt, now)
  if (timeError) return { ok: false, error: timeError, status: 400 }
  return {
    ok: true,
    value: {
      expectedVersion: input.expectedVersion,
      payload: { scheduledAt, endsAt, timeZone, notes: cleanText(input.notes, 5_000) ?? null },
    },
  }
}

export function buildMobileAppointmentOutcome(input: unknown): ParseResult<{
  leadId: string
  expectedVersion: number
  payload: { outcome: MobileAppointmentOutcome; notes: string | null }
}> {
  if (!isRecord(input) || !onlyKeys(input, OUTCOME_KEYS) || !validVersion(input.expectedVersion)) {
    return { ok: false, error: 'A contact, outcome, and version are required.', status: 400 }
  }
  const leadId = typeof input.leadId === 'string' ? input.leadId.trim() : ''
  if (!UUID.test(leadId) || !MOBILE_APPOINTMENT_OUTCOMES.includes(input.outcome as never)) {
    return { ok: false, error: 'A valid contact and appointment outcome are required.', status: 400 }
  }
  return {
    ok: true,
    value: {
      leadId,
      expectedVersion: input.expectedVersion,
      payload: {
        outcome: input.outcome as MobileAppointmentOutcome,
        notes: cleanText(input.notes, 5_000) ?? null,
      },
    },
  }
}
