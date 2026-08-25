export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { applyCrmEntityAuthority, safeReadLeadEntityContext } from '@/lib/server/crm-entity-foundation'
import { buildLeadProfilePatch } from '@/lib/server/lead-profile-command'
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
  const unauthorized = await requireAuthenticatedUser({ success: false, error: 'Unauthorized' })
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()

  const nowIso = new Date().toISOString()

  // Fetch the compatibility aggregate, canonical appointment, and canonical
  // entity projection in parallel. Manifest is historical and is not read.
  const [leadRes, appointmentRes, appointmentTaskRes, entityContext] = await Promise.all([
    db.from('leads')
      .select('*')
      .eq('id', id)
      .single(),
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
    safeReadLeadEntityContext(id),
  ])

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  const lead = applyCrmEntityAuthority(leadRes.data as LeadPayload, entityContext)
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

  return NextResponse.json({
    ...lead,
    nextAppointment,
    entityContext,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id) return NextResponse.json({ success: false, error: 'Contact id is required' }, { status: 400 })

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'Invalid JSON body' }, { status: 400 })
  }

  const command = buildLeadProfilePatch(body)
  if (!command.ok) {
    return NextResponse.json({ success: false, error: command.error }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin().rpc('crm_update_lead_profile_v1', {
    target_lead_id: id,
    target_patch: command.patch,
    target_actor_email: actor.email,
    target_actor_name: actor.name,
  })

  if (error) {
    console.error('[leads/:id] profile update failed:', error.message)
    if (error.message.includes('lead_not_found')) {
      return NextResponse.json({ success: false, error: 'Contact not found' }, { status: 404 })
    }
    if (error.message.includes('canonical_profile_conflict')) {
      return NextResponse.json({
        success: false,
        error: 'This change conflicts with the canonical contact record. Review the contact identity before saving again.',
        code: 'canonical_profile_conflict',
      }, { status: 409 })
    }
    if (error.message.includes('invalid_profile_field')) {
      return NextResponse.json({ success: false, error: 'One or more contact fields are invalid' }, { status: 400 })
    }
    return NextResponse.json({ success: false, error: 'Contact could not be saved' }, { status: 500 })
  }
  const result = readRecord(data)
  const updatedLead = readRecord(result?.lead)
  if (!updatedLead) {
    console.error('[leads/:id] profile update returned an invalid result')
    return NextResponse.json({ success: false, error: 'Contact could not be saved' }, { status: 500 })
  }

  const entityContext = await safeReadLeadEntityContext(id)
  return NextResponse.json({
    success: true,
    lead: applyCrmEntityAuthority(updatedLead as LeadPayload, entityContext),
    entityContext,
  })
}
