export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'
import { DEAD_REASONS, cleanDeadReason, deadReasonLabel } from '@/lib/lead-outcomes'

const ALLOWED_STATIONS = new Set([
  'intake', 'not_contacted', 'new',
  'attempting_contact', 'contacted',
  'qualifying', 'qualified', 'discovery',
  'appointment', 'appt_set', 'appointment_set',
  'offer', 'offer_prep', 'offer_made', 'offer_presented', 'negotiating', 'negotiations',
  'contract', 'contract_signed', 'under_contract',
  'inspection', 'closing_prep', 'closing',
  'closed', 'closed_won', 'closed_lost',
  'nurture', 'disposition', 'dead',
])

const APPOINTMENT_STATIONS = new Set(['appointment', 'appt_set', 'appointment_set'])

type StationRequestBody = {
  station?: string
  reason?: string
  deadReason?: string
  dead_reason?: string
  deadReasonNotes?: string
  allowMissingAppointmentDetails?: boolean
}

function hasUsableDate(value: unknown): boolean {
  if (typeof value !== 'string' || !value.trim()) return false
  const parsed = new Date(value)
  return !Number.isNaN(parsed.getTime())
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

async function leadHasAppointmentDetails(db: ReturnType<typeof supabaseAdmin>, leadId: string): Promise<boolean> {
  const [{ data: appointments }, { data: manifestRow }, { data: activityRows }] = await Promise.all([
    db
      .from('appointments')
      .select('id, scheduled_at, status')
      .eq('lead_id', leadId)
      .not('scheduled_at', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5),
    db
      .from('manifests')
      .select('manifest')
      .eq('lead_id', leadId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
    db
      .from('lead_activities')
      .select('id, metadata')
      .eq('lead_id', leadId)
      .eq('activity_type', 'appointment')
      .order('created_at', { ascending: false })
      .limit(5),
  ])

  if ((appointments ?? []).some((row) => {
    const status = typeof row.status === 'string' ? row.status.toLowerCase() : ''
    return !['cancelled', 'no_show'].includes(status) && hasUsableDate(row.scheduled_at)
  })) return true

  const manifest = readRecord(manifestRow?.manifest)
  const appointment = readRecord(readRecord(manifest.pipeline).appointment)
  if (hasUsableDate(appointment.scheduledAt)) return true

  return (activityRows ?? []).some((row) => {
    const metadata = readRecord(row.metadata)
    return hasUsableDate(metadata.scheduled_at) || hasUsableDate(metadata.due_date)
  })
}

/**
 * POST /api/admin/leads/[id]/station
 * Body: { station: string, reason?: string }
 * Auth: Bearer ADMIN_API_SECRET / CRON_SECRET (or signed-in admin)
 *
 * Under /api/admin/ so middleware lets bearer auth through. Cascades through
 * updateManifestAndCascade so scoring + briefings stay coherent.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = (await req.json().catch(() => ({}))) as StationRequestBody
  if (!body.station) return NextResponse.json({ error: 'body.station required' }, { status: 400 })
  if (!ALLOWED_STATIONS.has(body.station)) {
    return NextResponse.json(
      { error: `invalid station "${body.station}"`, allowed: [...ALLOWED_STATIONS] },
      { status: 400 },
    )
  }

  const db = supabaseAdmin()
  const { data: lead } = await db
    .from('leads')
    .select('id, station, full_name, classification, priority, dead_reason')
    .eq('id', id)
    .single()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const prevStation = lead.station
  const changedAt = new Date().toISOString()
  const movingToAppointment = APPOINTMENT_STATIONS.has(body.station)
  const movingToDead = body.station === 'dead'
  const deadReason = movingToDead
    ? cleanDeadReason(body.deadReason ?? body.dead_reason ?? body.reason)
    : null
  const deadReasonNotes = typeof body.deadReasonNotes === 'string' ? body.deadReasonNotes.trim() : ''
  const hasAppointmentDetails = movingToAppointment
    ? await leadHasAppointmentDetails(db, id)
    : false

  if (movingToDead && !deadReason) {
    return NextResponse.json(
      {
        error: 'Dead reason required before marking this lead dead.',
        requiresDeadReason: true,
        allowedDeadReasons: DEAD_REASONS,
      },
      { status: 400 },
    )
  }


  if (movingToDead && deadReason === 'other' && !deadReasonNotes) {
    return NextResponse.json(
      { error: 'Notes are required when Other is selected.', requiresDeadReasonNotes: true },
      { status: 400 },
    )
  }

  if (movingToAppointment && !hasAppointmentDetails && !body.allowMissingAppointmentDetails) {
    return NextResponse.json(
      {
        error: 'Appointment details required before moving this lead to Appointment Set.',
        requiresAppointmentDetails: true,
        nextAction: 'schedule_appointment',
      },
      { status: 409 },
    )
  }

  const { error: updErr } = await db
    .from('leads')
    .update({
      station: body.station,
      updated_at: changedAt,
      ...(movingToDead
        ? {
          priority: 'cold',
          classification: 'dead',
          opportunity_score: 0,
          dead_reason: deadReason,
          dead_at: changedAt,
          dead_by: 'system:admin_set_station',
        }
        : prevStation === 'dead'
          ? {
            classification: ['qualified', 'offer', 'offer_made', 'under_contract', 'contract', 'closing'].includes(body.station) ? 'opportunity' : 'lead',
            priority: lead.priority === 'cold' ? 'warm' : lead.priority ?? 'warm',
            dead_reason: null,
            dead_at: null,
            dead_by: null,
          }
          : {}),
    })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const cascadeOk = await updateManifestAndCascade(id, (manifest) => {
    manifest.currentStation = body.station as string
    manifest.auditTrail.push({
      timestamp: changedAt,
      agent: 'system:admin_set_station',
      action: 'station_changed_admin',
      details: {
        from: prevStation,
        to: body.station,
        reason: body.reason ?? null,
        dead_reason: deadReason,
        dead_reason_label: deadReason ? deadReasonLabel(deadReason) : null,
        dead_reason_notes: deadReasonNotes || null,
      },
    })
    if (prevStation === 'dead' && body.station !== 'dead' && manifest.scoring) {
      manifest.scoring.classification = ['qualified', 'offer', 'offer_made', 'under_contract', 'contract', 'closing'].includes(body.station as string) ? 'opportunity' : 'lead'
      manifest.scoring.worth_enriching = true
      manifest.scoring.reasoning = `Restored to active pipeline at ${body.station}.`
      manifest.scoring.scored_at = changedAt
      manifest.scoring.scored_by = 'notes'
    }
  }, 'admin_set_station').catch(() => false)

  const { error: activityError } = await db.from('lead_activities').insert({
    lead_id: id,
    activity_type: movingToDead ? 'outcome' : 'status_change',
    description: movingToDead && deadReason
      ? `Marked not a lead — ${deadReasonLabel(deadReason)}${deadReasonNotes ? ` — ${deadReasonNotes}` : ''}`
      : `Stage changed from ${prevStation || 'unassigned'} to ${body.station}`,
    agent: 'system:admin_set_station',
    metadata: {
      source: 'lead_stage_selector',
      old_station: prevStation,
      new_station: body.station,
      dead_reason: deadReason,
      dead_reason_label: deadReason ? deadReasonLabel(deadReason) : null,
      dead_reason_notes: deadReasonNotes || null,
    },
  })
  if (activityError) console.error('[admin station] Failed to write stage activity:', activityError.message)

  const ppcQualifiedConversion = await queuePpcQualifiedLeadConversion({
    leadId: id,
    fromStation: prevStation,
    toStation: body.station,
    changedBy: 'system:admin_set_station',
    reason: body.reason ?? null,
  }).catch((error) => ({
    queued: false as const,
    reason: error instanceof Error ? error.message : String(error),
  }))

  const ppcAppointmentConversion = movingToAppointment
    ? await queuePpcAppointmentBookedConversion({
      leadId: id,
      bookedAt: changedAt,
      appointmentType: 'manual_station_change',
      assignedTo: 'admin',
      source: 'admin_station_change',
    }).catch((error) => ({
      queued: false as const,
      reason: error instanceof Error ? error.message : String(error),
    }))
    : { queued: false as const, reason: 'not_appointment_station' }

  return NextResponse.json({
    ok: true,
    leadId: id,
    fullName: lead.full_name,
    from: prevStation,
    to: body.station,
    deadReason,
    cascaded: cascadeOk,
    ppcQualifiedConversion,
    ppcAppointmentConversion,
  })
}
