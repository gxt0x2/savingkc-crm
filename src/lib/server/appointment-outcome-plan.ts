import { createHash } from 'node:crypto'

import { cleanDeadReason } from '@/lib/lead-outcomes'
import type { CrmLifecycleStage } from '@/lib/server/crm-lifecycle'

export const APPOINTMENT_OUTCOMES = ['completed', 'no_show', 'cancelled', 'rescheduled'] as const
export type AppointmentOutcome = (typeof APPOINTMENT_OUTCOMES)[number]
export type CompletedNextStep = 'offer_presented' | 'qualified' | 'stay_with_follow_up'

const OPEN_APPOINTMENT_STATUSES = new Set(['scheduled', 'confirmed', 'rescheduled'])
const STAGE_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  qualified: 2,
  appointment_set: 3,
  offer_made: 4,
  under_contract: 5,
  closed_won: 6,
  closed_lost: 6,
  dead: 7,
}
const APPOINTMENT_TYPES = new Set(['phone_call', 'in_person', 'google_meet', 'onsite', 'virtual'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type AppointmentFollowUp = {
  title: string
  notes: string | null
  dueAt: string
}

export type ReplacementAppointment = {
  scheduledAt: string
  endsAt: string | null
  type: string | null
  title: string | null
  location: string | null
  timeZone: string | null
  notes: string | null
}

export type AppointmentOutcomeRequest = {
  leadId: string | null
  appointmentId: string | null
  outcome: AppointmentOutcome
  notes: string | null
  expectedVersion: number | null
  completedNextStep: CompletedNextStep | null
  followUp: AppointmentFollowUp | null
  notInterested: boolean
  deadReason: string | null
  deadReasonNotes: string | null
  replacementAppointment: ReplacementAppointment | null
}

export type OutcomePlan = {
  status: AppointmentOutcome
  stage: CrmLifecycleStage | null
  backwardException: boolean
  deadReason: string | null
  deadReasonNotes: string | null
  followUp: AppointmentFollowUp | null
  replacementAppointment: ReplacementAppointment | null
  stopReminders: true
  reason: string
}

type PlanSuccess = { ok: true; plan: OutcomePlan; continuation: boolean }
type PlanFailure = { ok: false; error: string; status: 400 | 409 }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const text = value.trim()
  return text ? text.slice(0, max) : null
}

function chicagoClock(date: Date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const read = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value)
  return { year: read('year'), month: read('month'), day: read('day'), hour: read('hour'), minute: read('minute') }
}

function chicagoLocalToUtc(year: number, month: number, day: number, hour: number, minute: number): Date {
  const utcSameClock = Date.UTC(year, month - 1, day, hour, minute, 0)
  for (const offsetHours of [5, 6]) {
    const candidate = new Date(utcSameClock + offsetHours * 60 * 60 * 1000)
    const clock = chicagoClock(candidate)
    if (clock.year === year && clock.month === month && clock.day === day && clock.hour === hour && clock.minute === minute) {
      return candidate
    }
  }
  return new Date(utcSameClock + 6 * 60 * 60 * 1000)
}

export function nextAppointmentFollowUpDue(now: Date): string {
  const clock = chicagoClock(now)
  const beforeMorning = clock.hour < 8 || (clock.hour === 8 && clock.minute < 30)
  const base = beforeMorning
    ? { year: clock.year, month: clock.month, day: clock.day }
    : (() => {
      const next = new Date(Date.UTC(clock.year, clock.month - 1, clock.day) + 24 * 60 * 60 * 1000)
      return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() }
    })()
  return chicagoLocalToUtc(base.year, base.month, base.day, 8, 30).toISOString()
}

export function stableOutcomeUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `a${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-')
}

export function resolveOutcomeStageMove(
  current: string,
  target: CrmLifecycleStage | null,
  allowBackwardException: boolean,
): { stage: CrmLifecycleStage | null; blocked: boolean; usedException: boolean } {
  if (!target || target === current) return { stage: null, blocked: false, usedException: false }
  const currentRank = STAGE_RANK[current]
  const targetRank = STAGE_RANK[target]
  const backward = currentRank !== undefined
    && targetRank !== undefined
    && target !== 'dead'
    && targetRank < currentRank
  if (!backward) return { stage: target, blocked: false, usedException: false }
  if (!allowBackwardException) return { stage: null, blocked: true, usedException: false }
  return { stage: target, blocked: false, usedException: true }
}

export function stageAfterMissedAppointment(_current: string, qualified: boolean): 'qualified' | 'contacted' {
  return qualified ? 'qualified' : 'contacted'
}

function outcomeReason(outcome: AppointmentOutcome, detail: string, exception: boolean): string {
  const base = `Appointment outcome ${outcome}: ${detail}`
  return exception ? `${base}. Outcome-driven stage exception.` : base
}

function automaticFollowUp(title: string, notes: string | null, now: Date): AppointmentFollowUp {
  return { title, notes, dueAt: nextAppointmentFollowUpDue(now) }
}

export function nextAppointmentDate(
  rows: Array<{ id: string; scheduled_at: string; notes?: string | null; status: string }>,
  now: number,
  excludeIds: string[] = [],
): { appointment_date: string | null; appointment_notes: string | null } {
  const excluded = new Set(excludeIds)
  const future = rows
    .filter((row) => !excluded.has(row.id))
    .filter((row) => ['scheduled', 'confirmed', 'rescheduled'].includes(row.status))
    .filter((row) => {
      const time = Date.parse(row.scheduled_at)
      return Number.isFinite(time) && time > now
    })
    .sort((left, right) => Date.parse(left.scheduled_at) - Date.parse(right.scheduled_at))
  const chosen = future[0]
  if (!chosen) return { appointment_date: null, appointment_notes: null }
  return { appointment_date: chosen.scheduled_at, appointment_notes: chosen.notes ?? null }
}

function readFollowUp(value: unknown): AppointmentFollowUp | null | 'invalid' {
  if (value == null) return null
  if (!isRecord(value)) return 'invalid'
  const title = cleanText(value.title, 200)
  const dueAt = typeof value.dueAt === 'string' ? Date.parse(value.dueAt) : Number.NaN
  if (!title || !Number.isFinite(dueAt)) return 'invalid'
  return { title, notes: cleanText(value.notes, 4000), dueAt: new Date(dueAt).toISOString() }
}

function readReplacement(value: unknown): ReplacementAppointment | null | 'invalid' {
  if (value == null) return null
  if (!isRecord(value)) return 'invalid'
  const scheduledAt = typeof value.scheduledAt === 'string' ? Date.parse(value.scheduledAt) : Number.NaN
  if (!Number.isFinite(scheduledAt)) return 'invalid'
  const endsAt = value.endsAt == null ? null : Date.parse(String(value.endsAt))
  if (value.endsAt != null && !Number.isFinite(endsAt)) return 'invalid'
  const type = cleanText(value.type, 40)
  if (type && !APPOINTMENT_TYPES.has(type)) return 'invalid'
  const timeZone = cleanText(value.timeZone, 100)
  if (timeZone) {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone }).format()
    } catch {
      return 'invalid'
    }
  }
  return {
    scheduledAt: new Date(scheduledAt).toISOString(),
    endsAt: endsAt != null && Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : null,
    type,
    title: cleanText(value.title, 200),
    location: cleanText(value.location, 500),
    timeZone,
    notes: cleanText(value.notes, 4000),
  }
}

export function readAppointmentOutcomeDetails(
  input: unknown,
): { ok: true; value: AppointmentOutcomeRequest } | { ok: false; error: string; status: 400 } {
  if (!isRecord(input)) return { ok: false, error: 'A valid contact and outcome are required', status: 400 }
  const outcome = input.outcome
  if (typeof outcome !== 'string' || !APPOINTMENT_OUTCOMES.includes(outcome as AppointmentOutcome)) {
    return { ok: false, error: 'A valid contact and outcome are required', status: 400 }
  }
  const leadId = input.leadId == null || input.leadId === '' ? null : input.leadId
  const appointmentId = input.appointmentId == null || input.appointmentId === '' ? null : input.appointmentId
  if ((leadId != null && (typeof leadId !== 'string' || !UUID.test(leadId)))
    || (appointmentId != null && (typeof appointmentId !== 'string' || !UUID.test(appointmentId)))) {
    return { ok: false, error: 'A valid contact and outcome are required', status: 400 }
  }
  if (input.expectedVersion != null && (!Number.isInteger(input.expectedVersion) || Number(input.expectedVersion) <= 0)) {
    return { ok: false, error: 'A valid appointment version is required', status: 400 }
  }
  const completedNextStep = input.completedNextStep == null ? null : input.completedNextStep
  if (completedNextStep != null && !['offer_presented', 'qualified', 'stay_with_follow_up'].includes(String(completedNextStep))) {
    return { ok: false, error: 'Say what happened after the appointment.', status: 400 }
  }
  const followUp = readFollowUp(input.followUp)
  if (followUp === 'invalid') return { ok: false, error: 'A follow-up needs a title and a due time.', status: 400 }
  const replacementAppointment = readReplacement(input.replacementAppointment)
  if (replacementAppointment === 'invalid') {
    return { ok: false, error: 'The new appointment time is not valid.', status: 400 }
  }
  const notInterested = input.notInterested === true
  const deadReason = notInterested ? cleanDeadReason(input.deadReason) : null
  if (notInterested && input.deadReason != null && input.deadReason !== '' && !deadReason) {
    return { ok: false, error: 'Choose a dead reason before marking this contact not a lead.', status: 400 }
  }
  return {
    ok: true,
    value: {
      leadId: typeof leadId === 'string' ? leadId : null,
      appointmentId: typeof appointmentId === 'string' ? appointmentId : null,
      outcome: outcome as AppointmentOutcome,
      notes: cleanText(input.notes, 4000),
      expectedVersion: typeof input.expectedVersion === 'number' ? input.expectedVersion : null,
      completedNextStep: completedNextStep as CompletedNextStep | null,
      followUp,
      notInterested,
      deadReason,
      deadReasonNotes: cleanText(input.deadReasonNotes, 4000),
      replacementAppointment,
    },
  }
}

export function planAppointmentOutcome(input: {
  request: AppointmentOutcomeRequest
  currentStage: string
  qualified: boolean
  appointmentStatus: string
  now: Date
}): PlanSuccess | PlanFailure {
  const { request, currentStage, qualified, appointmentStatus, now } = input
  const continuation = appointmentStatus === request.outcome
  if (!continuation && !OPEN_APPOINTMENT_STATUSES.has(appointmentStatus)) {
    return {
      ok: false,
      status: 409,
      error: 'This appointment outcome could not be applied. Refresh the calendar to check its current status.',
    }
  }

  const nowMs = now.getTime()
  let stage: CrmLifecycleStage | null = null
  let followUp: AppointmentFollowUp | null = null
  let deadReason: string | null = null
  let deadReasonNotes: string | null = null
  let replacementAppointment: ReplacementAppointment | null = null
  let detail: string = request.outcome

  if (request.outcome === 'completed') {
    if (request.completedNextStep === 'offer_presented') {
      stage = 'offer_made'
      detail = 'offer presented'
    } else if (request.completedNextStep === 'stay_with_follow_up') {
      if (!request.followUp) {
        return { ok: false, status: 400, error: 'Staying at the current stage requires a follow-up task.' }
      }
      if (Date.parse(request.followUp.dueAt) <= nowMs) {
        return { ok: false, status: 400, error: 'Choose a future follow-up time.' }
      }
      followUp = request.followUp
      detail = 'follow-up required, stage unchanged'
    } else if (request.completedNextStep === 'qualified') {
      stage = 'qualified'
      detail = 'no offer presented'
    } else {
      return { ok: false, status: 400, error: 'Say what happened after the appointment.' }
    }
  } else if (request.outcome === 'no_show') {
    stage = stageAfterMissedAppointment(currentStage, qualified)
    followUp = request.followUp ?? automaticFollowUp('Follow up after a missed appointment', request.notes, now)
    detail = stage === 'contacted' ? 'never qualified' : 'missed appointment'
  } else if (request.outcome === 'cancelled') {
    if (request.notInterested) {
      if (!request.deadReason) {
        return { ok: false, status: 400, error: 'A dead reason is required before marking this contact not a lead.' }
      }
      if (request.deadReason === 'other' && !request.deadReasonNotes && !request.notes) {
        return { ok: false, status: 400, error: 'Notes are required when Other is selected.' }
      }
      stage = 'dead'
      deadReason = request.deadReason
      deadReasonNotes = request.deadReasonNotes ?? request.notes
      detail = 'not interested'
    } else {
      stage = 'qualified'
      followUp = request.followUp ?? automaticFollowUp('Follow up after a cancelled appointment', request.notes, now)
      detail = 'cancelled, still a lead'
    }
  } else if (request.replacementAppointment) {
    const start = Date.parse(request.replacementAppointment.scheduledAt)
    if (!Number.isFinite(start) || start <= nowMs || start > nowMs + (2 * 365 * 24 * 60 * 60 * 1000)) {
      return { ok: false, status: 400, error: 'Save a future appointment within two years, or leave the new time blank.' }
    }
    if (request.replacementAppointment.endsAt) {
      const end = Date.parse(request.replacementAppointment.endsAt)
      if (end < start + (15 * 60 * 1000) || end > start + (24 * 60 * 60 * 1000)) {
        return { ok: false, status: 400, error: 'The new appointment must last at least 15 minutes and no more than 24 hours.' }
      }
    }
    replacementAppointment = request.replacementAppointment
    const rank = STAGE_RANK[currentStage]
    stage = rank !== undefined && rank < STAGE_RANK.appointment_set ? 'appointment_set' : null
    detail = 'future appointment saved'
  } else {
    stage = 'qualified'
    followUp = request.followUp ?? automaticFollowUp('Reschedule the appointment', request.notes, now)
    detail = 'no future appointment saved'
  }

  const decision = resolveOutcomeStageMove(currentStage, stage, true)
  if (decision.blocked || (stage && !decision.stage && stage !== currentStage)) {
    return { ok: false, status: 409, error: 'This appointment outcome cannot move the lead stage.' }
  }

  return {
    ok: true,
    continuation,
    plan: {
      status: request.outcome,
      stage: decision.stage,
      backwardException: decision.usedException,
      deadReason,
      deadReasonNotes,
      followUp,
      replacementAppointment,
      stopReminders: true,
      reason: outcomeReason(request.outcome, detail, decision.usedException),
    },
  }
}
