import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { updateManifestAndCascade } from '@/lib/manifest-sync'
import { supabase } from '@/lib/supabase-lazy'

export const runtime = 'nodejs'

/**
 * Cal.com booking webhook target — fires when a PPC visitor books a call.
 *
 * Two responsibilities:
 *   1. Stamp the manifest with appointment details and advance the station.
 *   2. Fire the `appointment_booked` Google Ads conversion *server-side* using
 *      the stored `gclid`. Server-side is mandatory for the high-value event;
 *      client-side firing would drop offline-conversion attribution.
 *
 * The Google Ads Offline Conversions API requires:
 *   - GOOGLE_ADS_CUSTOMER_ID            (no dashes, no AW- prefix)
 *   - GOOGLE_ADS_CONVERSION_ACTION_ID   (numeric ID of the appointment_booked action)
 *   - GOOGLE_ADS_DEVELOPER_TOKEN
 *   - GOOGLE_ADS_OAUTH_REFRESH_TOKEN    (or service account)
 *
 * Until those are provisioned, the conversion fire is logged and queued for
 * retry. The manifest write happens regardless so the rest of the CRM works.
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

  let gclid: string | undefined
  try {
    await updateManifestAndCascade(
      leadId,
      (m) => {
        m.currentStation = 'appointment-booked'
        m.priority = 'hot'
        m.booking = {
          ...(m.booking ?? {}),
          scheduledDate: parsed.scheduledAt?.slice(0, 10),
          scheduledTime: parsed.scheduledTime ?? parsed.scheduledAt?.slice(11, 16),
        }
        gclid = m.acquisition?.attribution?.gclid
      },
      'ppc-landing-book',
    )
  } catch (err) {
    console.error('[ppc/book] cascade failed', err)
    return NextResponse.json({ ok: false, error: 'Cascade failed' }, { status: 500 })
  }

  // Fire the server-side Google Ads conversion. This is intentionally a stub
  // until the Google Ads OAuth credentials are provisioned — we log so the
  // operator can see what would have fired.
  await fireServerSideAppointmentConversion({ leadId, manifestId: manifestId ?? null, gclid })

  return NextResponse.json({ ok: true, leadId, manifestId: manifestId ?? null })
}

async function fireServerSideAppointmentConversion(params: {
  leadId: string
  manifestId: string | null
  gclid: string | undefined
}): Promise<void> {
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID
  const actionId = process.env.GOOGLE_ADS_CONVERSION_ACTION_ID
  if (!customerId || !actionId || !params.gclid) {
    console.log('[ppc/book] appointment_booked conversion deferred (missing config or gclid)', params)
    return
  }

  // TODO: replace with real Google Ads Offline Conversions API call.
  // For now we log the payload that would be sent so it's easy to verify the
  // wiring once credentials land.
  console.log('[ppc/book] would fire appointment_booked', {
    customerId,
    actionId,
    gclid: params.gclid,
    conversionValue: 100,
    currencyCode: 'USD',
  })
}
