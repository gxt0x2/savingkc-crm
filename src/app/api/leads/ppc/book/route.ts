import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { supabase } from '@/lib/supabase-lazy'

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

export async function POST(req: NextRequest) {
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

  let attribution: Record<string, unknown> = {}
  try {
    await updateManifestAndCascade(
      leadId,
      (m) => {
        m.currentStation = 'appointment_set'
        m.priority = 'hot'
        m.booking = {
          ...(m.booking ?? {}),
          scheduledDate: parsed.scheduledAt?.slice(0, 10),
          scheduledTime: parsed.scheduledTime ?? parsed.scheduledAt?.slice(11, 16),
        }
        const manifestAttribution = m.acquisition?.attribution
        if (manifestAttribution && typeof manifestAttribution === 'object' && !Array.isArray(manifestAttribution)) {
          attribution = manifestAttribution as Record<string, unknown>
        }
      },
      'ppc-landing-book',
    )
  } catch (err) {
    console.error('[ppc/book] cascade failed', err)
    return NextResponse.json({ ok: false, error: 'Cascade failed' }, { status: 500 })
  }

  const conversion = await queueAppointmentBookedConversion({
    leadId,
    manifestId: manifestId ?? null,
    bookingId: parsed.bookingId,
    scheduledAt: parsed.scheduledAt,
    scheduledTime: parsed.scheduledTime,
    attendeeEmail: parsed.attendeeEmail,
    attendeePhone: parsed.attendeePhone,
    attribution,
  })

  return NextResponse.json({ ok: true, leadId, manifestId: manifestId ?? null, conversion })
}

async function queueAppointmentBookedConversion(params: {
  leadId: string
  manifestId: string | null
  bookingId?: string
  scheduledAt?: string
  scheduledTime?: string
  attendeeEmail?: string
  attendeePhone?: string
  attribution: Record<string, unknown>
}) {
  return enqueuePpcConversion({
    eventName: 'appointment_booked',
    eventCategory: 'appointment',
    leadId: params.leadId,
    manifestId: params.manifestId,
    dedupeKey: `lead:${params.leadId}:appointment_booked:${params.bookingId ?? params.manifestId ?? 'unknown'}`,
    optimizationRole: 'primary',
    conversionValue: 100,
    attribution: params.attribution,
    payload: {
      booking_id: params.bookingId ?? null,
      scheduled_at: params.scheduledAt ?? null,
      scheduled_time: params.scheduledTime ?? null,
      attendee_email: params.attendeeEmail ?? null,
      attendee_phone: params.attendeePhone ?? null,
    },
  })
}
