export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import {
  getGoogleAdsPhoneProfile,
  getGoogleAdsCallQualityMilestones,
  getCallQualityMilestones,
  isPpcTrackingNumber,
  parseCallDurationSeconds,
} from '@/lib/call-quality-events'
import { phoneLookupVariants } from '@/lib/google-ads-phone'
import { isInternalTestPhone } from '@/lib/internal-test-phones'
import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'

/**
 * Twilio status callback receiver for browser-initiated outbound calls.
 *
 * Wired from the outbound <Dial><Number> in /api/twiml-voice. Twilio POSTs
 * here for every state change (initiated / ringing / answered / completed),
 * including the final Status and any ErrorCode. We persist the terminal
 * outcome to lead_activities.metadata so failures stop being invisible.
 *
 * No auth — Twilio webhooks are signed but Vercel terminates TLS and we
 * trust the URL path. (Same posture as the existing /api/twilio-recording-callback.)
 */

type OutboundCallQualityInput = {
  supabase: SupabaseClient
  leadId: string | null
  callSid: string
  parentCallSid: string
  from: string
  to: string
  duration: number
  identity: string
}

async function logOutboundCallQualityMilestones(input: OutboundCallQualityInput): Promise<void> {
  const milestones = getCallQualityMilestones(input.duration)
  if (!milestones.length) return

  const dedupeKey = input.callSid || input.parentCallSid
  const isPpcCall = isPpcTrackingNumber(input.from)
  const isTestCall = isInternalTestPhone(input.to)
  const profile = getGoogleAdsPhoneProfile(input.from)
  const googleAdsEvents = new Set(getGoogleAdsCallQualityMilestones(input.duration).map((milestone) => milestone.event))

  for (const milestone of milestones) {
    try {
      if (dedupeKey) {
        const { data: existing } = await input.supabase
          .from('lead_activities')
          .select('id')
          .eq('metadata->>source', 'call_quality_milestone')
          .eq('metadata->>event', milestone.event)
          .eq('metadata->>dedupeKey', dedupeKey)
          .limit(1)

        if (existing && existing.length > 0) continue
      }

      const metadata = {
        source: 'call_quality_milestone',
        event: milestone.event,
        event_type: 'call_quality',
        optimization_role: 'secondary',
        conversion_value: milestone.conversionValue,
        currency: 'USD',
        threshold_seconds: milestone.seconds,
        duration: input.duration,
        outcome: 'connected',
        direction: 'outbound',
        from: input.from,
        to: input.to,
        is_test: isTestCall,
        callSid: input.callSid,
        parentCallSid: input.parentCallSid,
        dedupeKey,
        identity: input.identity,
        ...(isPpcCall && {
          traffic_source: 'google_ads',
          campaign: profile.campaign,
          tracking_number: profile.trackingDigits,
          lead_source: profile.source,
          landing_page: profile.landingPage,
          phone_profile: profile.key,
        }),
      }

      const { data: activity, error } = await input.supabase
        .from('lead_activities')
        .insert({
          lead_id: input.leadId,
          activity_type: 'status_change',
          description: `Call quality milestone: ${milestone.label}`,
          agent: input.identity || 'System',
          metadata,
        })
        .select('id')
        .single()

      if (error) {
        console.error('[twilio-call-status] Call quality milestone insert failed:', error)
        continue
      }

      if (isPpcCall && !isTestCall && googleAdsEvents.has(milestone.event)) {
        await enqueuePpcConversion(
          {
            eventName: milestone.event,
            eventCategory: 'call',
            leadId: input.leadId,
            activityId: activity?.id ?? null,
            dedupeKey: `call:${dedupeKey || `${input.from}:${input.to}`}:${milestone.event}`,
            optimizationRole: 'secondary',
            conversionValue: milestone.conversionValue,
            attribution: {
              utm_source: 'google',
              utm_medium: 'cpc',
              utm_campaign: profile.campaign,
            },
            payload: metadata,
          },
          input.supabase,
        )
      }
    } catch (error) {
      console.error('[twilio-call-status] Call quality milestone logging failed:', error)
    }
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.formData()
    const callSid = (body.get('CallSid') as string) || ''
    const parentCallSid = (body.get('ParentCallSid') as string) || ''
    const callStatus = (body.get('CallStatus') as string) || ''
    const errorCode = (body.get('ErrorCode') as string) || null
    const errorMessage = (body.get('ErrorMessage') as string) || null
    const from = (body.get('From') as string) || ''
    const to = (body.get('To') as string) || ''
    const duration = parseCallDurationSeconds(body.get('CallDuration')) || 0
    const url = new URL(req.url)
    const identity = url.searchParams.get('identity') || ''

    // Only log on terminal states. Twilio fires multiple times per call.
    const isTerminal = callStatus === 'completed' || callStatus === 'failed' || callStatus === 'canceled' || callStatus === 'busy' || callStatus === 'no-answer'
    if (!isTerminal) {
      return NextResponse.json({ ok: true, skipped: 'non_terminal', callStatus })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
    )

    let leadId: string | null = null
    for (const variant of phoneLookupVariants(to)) {
      const { data } = await supabase
        .from('leads')
        .select('id')
        .eq('phone', variant)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (data?.id) {
        leadId = data.id
        break
      }
    }

    // Stamp a diagnostic activity row so it shows up in the Activity Feed
    // alongside the existing call rows. Failed calls become discoverable.
    await supabase.from('lead_activities').insert({
      lead_id: leadId,
      activity_type: 'call',
      description: errorCode
        ? `Twilio status: ${callStatus} (error ${errorCode}: ${errorMessage || 'no message'})`
        : `Twilio status: ${callStatus}`,
      agent: identity || 'System',
      metadata: {
        source: 'twilio_status_callback',
        direction: 'outbound',
        callSid,
        parentCallSid,
        from,
        to,
        status: callStatus,
        duration,
        errorCode: errorCode ? Number(errorCode) : null,
        errorMessage,
        identity,
      },
    })

    if (callStatus === 'completed' && duration > 0) {
      await logOutboundCallQualityMilestones({
        supabase,
        leadId,
        callSid,
        parentCallSid,
        from,
        to,
        duration,
        identity,
      })
    }

    return NextResponse.json({ ok: true, callStatus, errorCode })
  } catch (err) {
    console.error('[twilio-call-status] Error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
