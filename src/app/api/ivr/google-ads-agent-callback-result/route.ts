import { NextResponse } from 'next/server'
import {
  getGoogleAdsPhoneProfile,
} from '@/lib/call-quality-events'
import { supabase } from '@/lib/supabase-lazy'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const XML_HEADERS: HeadersInit = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
}

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: XML_HEADERS })
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const leadId = url.searchParams.get('leadId') || ''
    const leadPhone = url.searchParams.get('leadPhone') || ''
    const calledNumber = url.searchParams.get('calledNumber') || ''
    const agentName = url.searchParams.get('agentName') || 'agent'
    const triggerCallSid = url.searchParams.get('triggerCallSid') || ''
    const profile = getGoogleAdsPhoneProfile(calledNumber)

    const body = await req.formData()
    const dialStatus = body.get('DialCallStatus')?.toString() || ''
    const dialCallSid = body.get('DialCallSid')?.toString() || ''
    const dialCallDuration = body.get('DialCallDuration')?.toString() || ''
    const connected = dialStatus === 'completed'

    if (leadId) {
      await supabase.from('lead_activities').insert({
        lead_id: leadId,
        activity_type: 'call',
        description: connected
          ? `${profile.label} agent-assisted callback connected with lead`
          : `${profile.label} lead did not answer agent-assisted callback`,
        agent: 'System',
        metadata: {
          source: profile.source,
          traffic_source: 'google_ads',
          campaign: profile.campaign,
          tracking_number: profile.trackingDigits,
          landing_page: profile.landingPage,
          phone_profile: profile.key,
          outcome: connected ? 'connected' : 'missed',
          direction: 'outbound',
          to: leadPhone,
          calledNumber,
          agentName,
          triggerCallSid,
          dialStatus,
          dialCallSid,
          dialCallDuration,
        },
      })
    }

    if (connected) {
      return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`)
    }

    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">The Google Ads lead did not answer. Goodbye.</Say>
  <Hangup/>
</Response>`)
  } catch (error) {
    console.error('[IVR/google-ads-agent-callback-result] Error:', error)
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`)
  }
}
