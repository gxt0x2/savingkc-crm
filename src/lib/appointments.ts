import { supabaseAdmin } from '@/lib/supabase/admin'

export type AppointmentType = 'phone_call' | 'in_person' | 'google_meet' | 'onsite' | 'virtual'
export type AppointmentStatus = 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled'
export type AppointmentSource = 'manual' | 'crm_call' | 'mojo_sync' | 'ai_extraction' | 'calendar_sync'

export interface AppointmentRow {
  id: string
  lead_id: string
  scheduled_at: string
  ends_at: string
  title: string
  type: AppointmentType
  status: AppointmentStatus
  address: string | null
  location: string | null
  time_zone: string
  notes: string | null
  source: AppointmentSource
  source_call_id: string | null
  assigned_to: string | null
  sequence_enabled: boolean
  version: number
  provider_event_id: string | null
  provider_sync_status: 'not_configured' | 'pending' | 'synced' | 'failed'
  provider_synced_at: string | null
  provider_sync_error: string | null
  created_at: string
  updated_at: string
}

interface UpsertInput {
  appointmentId?: string
  leadId: string
  scheduledAt: string
  type?: AppointmentType
  address?: string | null
  notes?: string | null
  source: AppointmentSource
  sourceCallId?: string | null
  assignedTo?: string | null
  sequenceEnabled?: boolean
}

const DEDUP_WINDOW_MIN = 60

// Upsert an appointment for a lead. Dedup window: if a non-terminal
// appointment exists within ±60 minutes of scheduledAt, update that one.
// The CRM editor uses the atomic sequence RPC and explicit appointment ID
// so reschedules also invalidate reminders for the previously selected time.
export async function upsertAppointmentFromCall(input: UpsertInput): Promise<AppointmentRow | null> {
  const db = supabaseAdmin()
  const target = new Date(input.scheduledAt).getTime()
  if (!Number.isFinite(target)) return null
  if (input.sequenceEnabled !== undefined) {
    const { data, error } = await db.rpc('upsert_sequence_appointment_v1', {
      p_appointment_id: input.appointmentId || null, p_lead_id: input.leadId,
      p_scheduled_at: new Date(target).toISOString(), p_type: input.type || 'phone_call',
      p_address: input.address || null, p_notes: input.notes || null,
      p_assigned_to: input.assignedTo || null, p_enabled: input.sequenceEnabled,
    })
    if (error) { console.error('[appointments] sequence booking failed:', error.message); return null }
    return (Array.isArray(data) ? data[0] : data) as AppointmentRow | null
  }

  const windowMs = DEDUP_WINDOW_MIN * 60 * 1000
  const lo = new Date(target - windowMs).toISOString()
  const hi = new Date(target + windowMs).toISOString()

  let lookup = db
    .from('appointments')
    .select('*')
    .eq('lead_id', input.leadId)
    .in('status', ['scheduled', 'confirmed', 'rescheduled'])
  lookup = input.appointmentId ? lookup.eq('id', input.appointmentId) : lookup.gte('scheduled_at', lo).lte('scheduled_at', hi)
  const { data: existing, error: lookupError } = await lookup
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (lookupError || (input.appointmentId && !existing)) return null

  const payload: Partial<AppointmentRow> = {
    lead_id: input.leadId,
    scheduled_at: new Date(input.scheduledAt).toISOString(),
    type: input.type || 'phone_call',
    status: 'scheduled',
    source: input.source,
    source_call_id: input.sourceCallId ?? null,
    assigned_to: input.assignedTo ?? null,
    address: input.address ?? null,
    notes: input.notes ?? null,
    updated_at: new Date().toISOString(),
  }

  if (existing) {
    const { data, error } = await db
      .from('appointments')
      .update({
        scheduled_at: payload.scheduled_at,
        type: payload.type,
        address: payload.address ?? existing.address,
        notes: payload.notes ?? existing.notes,
        source: payload.source,
        source_call_id: payload.source_call_id ?? existing.source_call_id,
        assigned_to: payload.assigned_to ?? existing.assigned_to,
        updated_at: payload.updated_at,
        ...(existing.status === 'rescheduled' ? { status: 'scheduled' } : {}),
      })
      .eq('id', existing.id)
      .select('*')
      .single()
    if (error) {
      console.error('[appointments] update error:', error)
      return null
    }
    return data as AppointmentRow
  }

  const { data, error } = await db
    .from('appointments')
    .insert(payload)
    .select('*')
    .single()
  if (error) {
    console.error('[appointments] insert error:', error)
    return null
  }
  return data as AppointmentRow
}

// Returns the next upcoming non-terminal appointment for a lead, or null.
export async function getNextAppointment(leadId: string): Promise<AppointmentRow | null> {
  const db = supabaseAdmin()
  const nowIso = new Date().toISOString()
  const { data } = await db
    .from('appointments')
    .select('*')
    .eq('lead_id', leadId)
    .in('status', ['scheduled', 'confirmed', 'rescheduled'])
    .gte('scheduled_at', nowIso)
    .order('scheduled_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  return (data as AppointmentRow) ?? null
}
