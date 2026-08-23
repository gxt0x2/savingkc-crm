import { resolveTaskAssignee } from '@/lib/api/task-assignee'
type OperatorAppointmentType = 'phone_call' | 'in_person' | 'google_meet'

const APPOINTMENT_TYPES = new Set<OperatorAppointmentType>(['phone_call', 'in_person', 'google_meet'])

export type AppointmentCommandResult =
  | {
      ok: true
      command: {
        leadId: string
        type: OperatorAppointmentType
        scheduledAt: string
        assignedTo: string
        notes: string | null
        sendReminder: boolean
      }
    }
  | { ok: false; error: string; status: 400 | 403 }

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value.trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

export function buildAppointmentCommand(input: unknown, actorName: string, now = Date.now()): AppointmentCommandResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'Appointment command required', status: 400 }
  }
  const body = input as Record<string, unknown>
  const leadId = cleanText(body.leadId, 100)
  const scheduledText = cleanText(body.scheduledAt, 100)
  const scheduledMs = scheduledText ? new Date(scheduledText).getTime() : Number.NaN
  const latestAllowed = now + (2 * 365 * 24 * 60 * 60 * 1000)
  if (!leadId || !Number.isFinite(scheduledMs) || scheduledMs <= now || scheduledMs > latestAllowed) {
    return { ok: false, error: 'Contact and a valid future appointment time are required', status: 400 }
  }

  const requestedType = cleanText(body.type, 30) || 'phone_call'
  if (!APPOINTMENT_TYPES.has(requestedType as OperatorAppointmentType)) {
    return { ok: false, error: 'Choose a valid appointment type', status: 400 }
  }

  const assignment = resolveTaskAssignee(body.assignedTo, actorName, { defaultToActor: true })
  if (!assignment.authorized || !assignment.assignedTo) {
    return { ok: false, error: 'Appointment assignee is not authorized', status: 403 }
  }

  return {
    ok: true,
    command: {
      leadId,
      type: requestedType as OperatorAppointmentType,
      scheduledAt: new Date(scheduledMs).toISOString(),
      assignedTo: assignment.assignedTo,
      notes: cleanText(body.notes, 5_000),
      sendReminder: body.sendReminder === true,
    },
  }
}
