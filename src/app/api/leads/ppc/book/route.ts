import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { queuePpcAppointmentBookedConversion } from '@/lib/ppc/appointment-booked-conversion'
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
      },
      'ppc-landing-book',
    )
  } catch (err) {
    console.error('[ppc/book] cascade failed', err)
    return NextResponse.json({ ok: false, error: 'Cascade failed' }, { status: 500 })
  }

  const conversion = await queuePpcAppointmentBookedConversion({
    leadId,
    appointmentId: parsed.bookingId ?? null,
    bookingId: parsed.bookingId ?? null,
    scheduledAt: parsed.scheduledAt,
    scheduledTime: parsed.scheduledTime,
    source: 'ppc-landing-book',
  })

  return NextResponse.json({ ok: true, leadId, manifestId: manifestId ?? null, conversion })
}
