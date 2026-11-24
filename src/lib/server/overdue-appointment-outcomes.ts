export const OVERDUE_APPOINTMENT_OUTCOME_MS = 24 * 60 * 60 * 1000

export type OverdueScheduledAppointment = {
  id: string
  leadId: string | null
  scheduledAt: string
  type: string | null
  status: 'scheduled'
  assignedTo: string | null
  title: string | null
}

type AppointmentQuery = {
  select: (columns: string) => AppointmentQuery
  eq: (column: string, value: string) => AppointmentQuery
  lt: (column: string, value: string) => AppointmentQuery
  order: (column: string, options: { ascending: boolean }) => AppointmentQuery
  limit: (count: number) => PromiseLike<{ data: Array<Record<string, unknown>> | null; error: { message: string } | null }>
}

type AppointmentDb = {
  from: (table: string) => unknown
}

export function isOverdueScheduledAppointment(
  row: { status: string; scheduledAt: string },
  now: number,
): boolean {
  if (row.status !== 'scheduled') return false
  const time = Date.parse(row.scheduledAt)
  return Number.isFinite(time) && time <= now - OVERDUE_APPOINTMENT_OUTCOME_MS
}

export async function listOverdueScheduledAppointments(
  db: AppointmentDb,
  options?: { now?: Date; limit?: number },
): Promise<{ rows: OverdueScheduledAppointment[]; error: string | null; cutoff: string }> {
  const now = options?.now ?? new Date()
  const limit = Math.min(Math.max(options?.limit ?? 30, 1), 50)
  const cutoff = new Date(now.getTime() - OVERDUE_APPOINTMENT_OUTCOME_MS).toISOString()
  const query = db.from('appointments') as AppointmentQuery
  const { data, error } = await query
    .select('id, lead_id, scheduled_at, type, status, assigned_to, title')
    .eq('status', 'scheduled')
    .lt('scheduled_at', cutoff)
    .order('scheduled_at', { ascending: true })
    .limit(limit)
  if (error) return { rows: [], error: error.message, cutoff }
  const rows = (data ?? []).flatMap((row) => {
    const scheduledAt = typeof row.scheduled_at === 'string' ? row.scheduled_at : ''
    const status = typeof row.status === 'string' ? row.status : ''
    if (!isOverdueScheduledAppointment({ status, scheduledAt }, now.getTime())) return []
    return [{
      id: String(row.id),
      leadId: typeof row.lead_id === 'string' ? row.lead_id : null,
      scheduledAt,
      type: typeof row.type === 'string' ? row.type : null,
      status: 'scheduled' as const,
      assignedTo: typeof row.assigned_to === 'string' ? row.assigned_to : null,
      title: typeof row.title === 'string' ? row.title : null,
    }]
  })
  return { rows, error: null, cutoff }
}
