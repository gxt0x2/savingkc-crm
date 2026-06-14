export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

type JsonRecord = Record<string, unknown>

type LeadPayload = JsonRecord & {
  appointment_date?: string | null
  appointment_notes?: string | null
  property_address?: string | null
}

type AppointmentDbRow = {
  id?: string | null
  scheduled_at?: string | null
  type?: string | null
  status?: string | null
  assigned_to?: string | null
  address?: string | null
  notes?: string | null
  source?: string | null
}

type ActivityTaskRow = {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: JsonRecord | null
  created_at: string
}

function readRecord(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : null
}

function normalizeDateValue(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const trimmed = value.trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const parsedDateOnly = new Date(`${trimmed}T00:00:00Z`)
    return Number.isFinite(parsedDateOnly.getTime()) ? parsedDateOnly.toISOString() : null
  }
  const withTimezone = /(?:z|[+-]\d{2}:?\d{2})$/i.test(trimmed)
  const parseValue = withTimezone ? trimmed : `${trimmed}Z`
  const parsed = new Date(parseValue)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function normalizeAppointment(row: {
  id?: string | null
  scheduled_at?: string | null
  scheduledAt?: string | null
  type?: string | null
  status?: string | null
  assigned_to?: string | null
  assignedTo?: string | null
  address?: string | null
  notes?: string | null
  source?: string | null
} | null | undefined) {
  const scheduledAt = normalizeDateValue(row?.scheduled_at ?? row?.scheduledAt)
  if (!scheduledAt) return null
  return {
    appointmentId: row?.id ?? null,
    type: row?.type ?? 'phone_call',
    scheduledAt,
    status: row?.status ?? 'scheduled',
    assignedTo: row?.assigned_to ?? row?.assignedTo ?? null,
    address: row?.address ?? null,
    notes: row?.notes ?? null,
    source: row?.source ?? null,
  }
}

function parseBookingFallback(manifest: JsonRecord | null | undefined) {
  const pipeline = readRecord(manifest?.pipeline)
  const appointment = normalizeAppointment(readRecord(pipeline?.appointment))
  if (appointment) return appointment

  const booking = readRecord(manifest?.booking)
  const scheduledAt = normalizeDateValue(booking?.scheduledAt)
  if (scheduledAt) {
    return normalizeAppointment({
      id: typeof booking?.bookingId === 'string' ? booking.bookingId : null,
      scheduledAt,
      type: 'phone_call',
      status: 'scheduled',
      assignedTo: 'casey',
      notes: 'PPC booking',
      source: 'manifest_booking',
    })
  }

  const scheduledDate = typeof booking?.scheduledDate === 'string' ? booking.scheduledDate : null
  const scheduledTime = typeof booking?.scheduledTime === 'string' ? booking.scheduledTime : null
  if (scheduledDate) {
    const parsed = new Date(`${scheduledDate}T${(scheduledTime || '09:00').slice(0, 5)}:00-05:00`)
    if (Number.isFinite(parsed.getTime())) {
      return normalizeAppointment({
        id: typeof booking?.bookingId === 'string' ? booking.bookingId : null,
        scheduledAt: parsed.toISOString(),
        type: 'phone_call',
        status: 'scheduled',
        assignedTo: 'casey',
        notes: 'PPC booking',
        source: 'manifest_booking',
      })
    }
  }

  return null
}

function appointmentFromActivities(rows: ActivityTaskRow[] | null | undefined) {
  const candidates: Array<{ row: ActivityTaskRow; dueDate: string; dueMs: number; sourceRank: number }> = []
  for (const row of rows ?? []) {
    const metadata = readRecord(row.metadata)
    const status = typeof metadata?.status === 'string' ? metadata.status : 'pending'
    if (status === 'completed' || status === 'done' || status === 'dismissed') continue

    const isAppointmentActivity = row.activity_type === 'appointment'
    const taskType = typeof metadata?.task_type === 'string' ? metadata.task_type.toLowerCase() : ''
    const title = `${row.description || ''} ${typeof metadata?.title === 'string' ? metadata.title : ''}`.toLowerCase()
    if (!isAppointmentActivity && taskType !== 'appointment' && !title.includes('appointment')) continue

    const dueDate = normalizeDateValue(metadata?.scheduled_at ?? metadata?.due_date)
    if (!dueDate) continue
    candidates.push({
      row,
      dueDate,
      dueMs: new Date(dueDate).getTime(),
      sourceRank: isAppointmentActivity ? 0 : 1,
    })
  }

  const now = Date.now()
  candidates.sort((a, b) => {
    const aFuture = a.dueMs >= now
    const bFuture = b.dueMs >= now
    if (aFuture !== bFuture) return aFuture ? -1 : 1
    if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank
    return aFuture ? a.dueMs - b.dueMs : b.dueMs - a.dueMs
  })

  const candidate = candidates[0]
  if (candidate) {
    const metadata = readRecord(candidate.row.metadata)

    return normalizeAppointment({
      id: candidate.row.id,
      scheduledAt: candidate.dueDate,
      type: typeof metadata?.type === 'string' ? metadata.type : 'phone_call',
      status: 'scheduled',
      assignedTo: typeof metadata?.assigned_to === 'string' ? metadata.assigned_to : candidate.row.agent,
      notes: candidate.row.description,
      source: candidate.row.activity_type === 'appointment' ? 'appointment_activity' : 'appointment_task',
    })
  }
  return null
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()

  const nowIso = new Date().toISOString()

  // Fetch lead + manifest + canonical next appointment in parallel
  const [leadRes, manifestRes, appointmentRes, appointmentTaskRes] = await Promise.all([
    db.from('leads')
      .select('*')
      .eq('id', id)
      .single(),
    db.from('manifests')
      .select('manifest')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db.from('appointments')
      .select('id, scheduled_at, type, status, address, notes, source, assigned_to')
      .eq('lead_id', id)
      .in('status', ['scheduled', 'confirmed', 'rescheduled'])
      .gte('scheduled_at', nowIso)
      .order('scheduled_at', { ascending: true })
      .limit(1)
      .maybeSingle(),
    db.from('lead_activities')
      .select('id, activity_type, description, agent, metadata, created_at')
      .eq('lead_id', id)
      .in('activity_type', ['appointment', 'task'])
      .order('created_at', { ascending: false })
      .limit(50),
  ])

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const lead = leadRes.data as LeadPayload
  const manifestContainer = readRecord(manifestRes.data)?.manifest
  const manifestRecord = readRecord(manifestContainer)
  const manifest = readRecord(manifestRecord?.manifest) ?? manifestRecord
  const nextAppointment = normalizeAppointment((appointmentRes.data as AppointmentDbRow | null) ?? null)
    ?? normalizeAppointment({
      id: null,
      scheduledAt: lead.appointment_date ?? null,
      type: 'phone_call',
      status: 'scheduled',
      assignedTo: null,
      address: lead.property_address ?? null,
      notes: lead.appointment_notes ?? null,
      source: 'lead_cache',
    })
    ?? appointmentFromActivities((appointmentTaskRes.data as ActivityTaskRow[] | null) ?? null)
    ?? parseBookingFallback(manifest)

  return NextResponse.json({
    ...lead,
    manifest,
    nextAppointment,
  })
}
