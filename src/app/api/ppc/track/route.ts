import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getPpcRequestContext } from '@/lib/ppc/request-context'
import { recordPpcTrackingEvent } from '@/lib/ppc/tracking-events'

export const runtime = 'nodejs'

const AttributionSchema = z
  .object({
    utm_source: z.string().max(120).optional(),
    utm_medium: z.string().max(120).optional(),
    utm_campaign: z.string().max(180).optional(),
    utm_term: z.string().max(180).optional(),
    utm_content: z.string().max(180).optional(),
    keyword: z.string().max(180).optional(),
    matchtype: z.string().max(80).optional(),
    campaignid: z.string().max(180).optional(),
    adgroupid: z.string().max(180).optional(),
    gclid: z.string().max(180).optional(),
    gbraid: z.string().max(180).optional(),
    wbraid: z.string().max(180).optional(),
    oppref: z.string().max(240).optional(),
    gad_source: z.string().max(120).optional(),
    gad_campaignid: z.string().max(180).optional(),
    gad_adgroupid: z.string().max(180).optional(),
    referrer: z.string().max(500).optional(),
    landingUrl: z.string().max(500).optional(),
  })
  .optional()

const BodySchema = z.object({
  eventId: z.string().min(8).max(240),
  eventName: z.string().min(2).max(120),
  eventCategory: z.enum(['visit', 'form', 'phone', 'call', 'conversion', 'error', 'web']).optional(),
  eventTime: z.string().max(80).optional(),
  sessionId: z.string().max(160).optional(),
  visitorId: z.string().max(160).optional(),
  leadId: z.string().uuid().optional(),
  manifestId: z.string().uuid().optional(),
  activityId: z.string().uuid().optional(),
  pagePath: z.string().max(240).optional(),
  pageLocation: z.string().max(500).optional(),
  pageReferrer: z.string().max(500).optional(),
  trafficSource: z.string().max(120).optional(),
  campaign: z.string().max(180).optional(),
  formStep: z.number().int().min(1).max(10).optional(),
  formStatus: z.string().max(120).optional(),
  situation: z.string().max(80).optional(),
  timeline: z.string().max(80).optional(),
  condition: z.string().max(80).optional(),
  phoneNumber: z.string().max(32).optional(),
  smsConsent: z.boolean().optional(),
  isTest: z.boolean().optional(),
  attribution: AttributionSchema,
  payload: z.record(z.unknown()).optional(),
})

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

export async function POST(req: NextRequest) {
  let parsed: z.infer<typeof BodySchema>
  try {
    parsed = BodySchema.parse(await req.json())
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues[0]?.message ?? 'Invalid request' : 'Invalid request'
    return NextResponse.json({ ok: false, error: message }, { status: 400, headers: corsHeaders })
  }

  const requestContext = getPpcRequestContext(req)
  const result = await recordPpcTrackingEvent({
    ...parsed,
    isTest: parsed.isTest || requestContext.isInternal,
    payload: {
      ...(parsed.payload ?? {}),
      device: requestContext.devicePayload,
      is_internal: requestContext.isInternal,
      internal_reasons: requestContext.internalReasons,
    },
  })
  if (!result.recorded) {
    return NextResponse.json(
      { ok: false, error: result.reason },
      { status: 202, headers: corsHeaders },
    )
  }

  return NextResponse.json({ ok: true }, { headers: corsHeaders })
}
