import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
import { supabase } from '@/lib/supabase-lazy'
import { upsertAppointmentFromCall } from '@/lib/appointments'

export const runtime = 'nodejs'

/**
 * Cal.com booking webhook target — fires when a PPC visitor books a call.
 *
 * Two responsibilities:
 *   1. Stamp the manifest with appointment details and advance the station.
 *   2. Queue the `appointment_booked` Google Ads conversion server-side using
 *      the stored attribution. Server-side is mandatory for the high-value
 *      event; client-side firing would drop offline-conversion attribution.
 */

const BodySchema = z.object({
  manifestId: z.string().min(1).optional(),
  leadId: z.string().min(1).optional(),
  bookingId: z.string().optional(),
  scheduledAt: z.string().optional(),
  scheduledTime: z.string().optional(),
  attendeeName: z.string().optional(),
  attendeeEmail: z.string().optional(),
  attendeePhone: z.string().optional(),
  // Cal.com sends the metadata object back to us
  metadata: z
    .object({
      manifestId: z.string().optional(),
      leadId: z.string().optional(),
    })
    .optional(),
})

function configuredWebhookSecret(): string | null {
  const secret = process.env.PPC_BOOKING_WEBHOOK_SECRET || process.env.CAL_COM_WEBHOOK_SECRET || ''
  return secret.trim() || null
}

function requestWebhookSecret(req: NextRequest): string | null {
  const auth = req.headers.get('authorization') || ''
  const bearer = auth.match(/^Bearer\s+(.+)$/i)?.[1]?.trim()
  return (
    bearer ||
    req.headers.get('x-ppc-booking-secret')?.trim() ||
    req.headers.get('x-webhook-secret')?.trim() ||
    null
  )
}

function normalizeBookingDateTime(input: {
  scheduledAt?: string
  scheduledTime?: string
}): string | null {
  const scheduledAt = input.scheduledAt?.trim()
  const scheduledTime = input.scheduledTime?.trim()
  if (!scheduledAt) return null

  if (/^\d{4}-\d{2}-\d{2}$/.test(scheduledAt)) {
    const time = scheduledTime && /^\d{2}:\d{2}/.test(scheduledTime) ? scheduledTime.slice(0, 5) : '09:00'
    const parsed = new Date(`${scheduledAt}T${time}:00-05:00`)
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
  }

  const parsed = new Date(scheduledAt)
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null
}

function unauthorizedWebhook(req: NextRequest): NextResponse | null {
  const expected = configuredWebhookSecret()
  if (!expected) {
    console.error('[ppc/book] PPC booking webhook secret is not configured')
    return NextResponse.json({ ok: false, error: 'Webhook secret is not configured' }, { status: 503 })
  }

  if (requestWebhookSecret(req) === expected) return null
  return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
}

export async function POST(req: NextRequest) {
  const unauthorized = unauthorizedWebhook(req)
  if (unauthorized) return unauthorized

  let parsed: z.infer<typeof BodySchema>
  try {
    parsed = BodySchema.parse(await req.json())
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? 'Invalid request' : 'Invalid request'
    return NextResponse.json({ ok: false, error: message }, { status: 400 })
  }

  const manifestId = parsed.manifestId ?? parsed.metadata?.manifestId
  const leadIdFromBody = parsed.leadId ?? parsed.metadata?.leadId

  let leadId = leadIdFromBody ?? null
  if (!leadId && manifestId) {
    const { data } = await supabase
      .from('manifests')
      .select('lead_id')
      .eq('id', manifestId)
      .maybeSingle()
    leadId = data?.lead_id ?? null
  }

  if (!leadId) {
    return NextResponse.json({ ok: false, error: 'No manifest or lead identifier' }, { status: 400 })
  }

  const scheduledIso = normalizeBookingDateTime({
    scheduledAt: parsed.scheduledAt,
    scheduledTime: parsed.scheduledTime,
  })
  if (!scheduledIso) {
    return NextResponse.json({ ok: false, error: 'scheduledAt required' }, { status: 400 })
  }

  const appointmentNotes = [
    'PPC booking',
    parsed.attendeeName ? `Seller: ${parsed.attendeeName}` : null,
    parsed.attendeePhone ? `Phone: ${parsed.attendeePhone}` : null,
    parsed.attendeeEmail ? `Email: ${parsed.attendeeEmail}` : null,
  ].filter(Boolean).join(' · ')

  const canonicalAppointment = await upsertAppointmentFromCall({
    leadId,
    scheduledAt: scheduledIso,
    type: 'phone_call',
    notes: appointmentNotes || null,
    source: 'calendar_sync',
    sourceCallId: parsed.bookingId ?? null,
    assignedTo: 'casey',
  })
  const appointmentId = canonicalAppointment?.id ?? parsed.bookingId ?? randomUUID()

  try {
    await updateManifestAndCascade(
      leadId,
      (m) => {
        m.currentStation = 'appointment_set'
        m.priority = 'hot'
        m.pipeline = m.pipeline ?? {}
        m.pipeline.appointment = {
          appointmentId,
          type: 'phone_call',
          scheduledAt: scheduledIso,
          createdAt: new Date().toISOString(),
          status: 'scheduled',
          confirmationCount: 0,
          lastSellerResponse: null,
          ghostRiskScore: 0,
          ghostProtocolActive: false,
          reminderAutomationEnabled: true,
          reminderAutomationEnabledAt: new Date().toISOString(),
          reminderAutomationSource: 'ppc-landing-book',
          automationLog: [],
          assignedTo: 'casey',
          address: null,
          notes: appointmentNotes || null,
        }
        m.booking = {
          ...(m.booking ?? {}),
          bookingId: parsed.bookingId ?? undefined,
          scheduledDate: scheduledIso.slice(0, 10),
          scheduledTime: parsed.scheduledTime ?? scheduledIso.slice(11, 16),
          scheduledAt: scheduledIso,
        }
      },
      'ppc-landing-book',
    )
  } catch (err) {
    console.error('[ppc/book] cascade failed', err)
    return NextResponse.json({ ok: false, error: 'Cascade failed' }, { status: 500 })
  }

  await supabase
    .from('leads')
    .update({
      station: 'appointment_set',
      priority: 'hot',
      appointment_date: scheduledIso,
      appointment_notes: appointmentNotes || 'PPC booking',
      updated_at: new Date().toISOString(),
    })
    .eq('id', leadId)

  const { data: appointmentActivity } = await supabase
    .from('lead_activities')
    .insert({
      lead_id: leadId,
      activity_type: 'appointment',
      description: `PPC appointment booked for ${new Date(scheduledIso).toLocaleString('en-US', {
        timeZone: 'America/Chicago',
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })}`,
      agent: 'PPC booking',
      metadata: {
        appointment_id: appointmentId,
        booking_id: parsed.bookingId ?? null,
        scheduled_at: scheduledIso,
        due_date: scheduledIso,
        assigned_to: 'casey',
        status: 'scheduled',
        source: 'ppc-landing-book',
      },
    })
    .select('id')
    .maybeSingle()

  const conversion = await queuePpcAppointmentBookedConversion({
    leadId,
    appointmentId,
    bookingId: parsed.bookingId ?? null,
    activityId: appointmentActivity?.id ?? null,
    scheduledAt: scheduledIso,
    scheduledTime: parsed.scheduledTime,
    appointmentType: 'phone_call',
    assignedTo: 'casey',
    source: 'ppc-landing-book',
  })

  return NextResponse.json({
    ok: true,
    leadId,
    manifestId: manifestId ?? null,
    appointmentId,
    scheduledAt: scheduledIso,
    conversion,
  })
}
