export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { queuePpcQualifiedLeadConversion } from '@/lib/ppc/qualified-lead-conversion'

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

  const body = (await req.json().catch(() => ({}))) as { station?: string; reason?: string }
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
    .select('id, station, full_name')
    .eq('id', id)
    .single()
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

  const prevStation = lead.station
  const changedAt = new Date().toISOString()

  const { error: updErr } = await db
    .from('leads')
    .update({ station: body.station, updated_at: changedAt })
    .eq('id', id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  const cascadeOk = await updateManifestAndCascade(id, (manifest) => {
    manifest.currentStation = body.station as string
    manifest.auditTrail.push({
      timestamp: changedAt,
      agent: 'system:admin_set_station',
      action: 'station_changed_admin',
      details: { from: prevStation, to: body.station, reason: body.reason ?? null },
    })
  }, 'admin_set_station').catch(() => false)

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

  const ppcAppointmentConversion = APPOINTMENT_STATIONS.has(body.station)
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
    cascaded: cascadeOk,
    ppcQualifiedConversion,
    ppcAppointmentConversion,
  })
}
