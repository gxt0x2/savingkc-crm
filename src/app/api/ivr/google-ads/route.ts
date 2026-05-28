import { NextResponse } from 'next/server'
import { getAgentRouting } from '@/lib/agent-routing'
import { GOOGLE_ADS_PHONE_NUMBER } from '@/lib/call-quality-events'
import {
  googleAdsNewCallTeamMessage,
  notifyGoogleAdsTeam,
  resolveGoogleAdsLeadContext,
} from '@/lib/google-ads-phone'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'

const XML_HEADERS: HeadersInit = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
}

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: XML_HEADERS })
}

function esc(value: string): string {
  return encodeURIComponent(value || '')
}

export async function POST(req: Request) {
  try {
    const url = new URL(req.url)
    const form = await req.formData().catch(() => null)
    const from = url.searchParams.get('from') || form?.get('From')?.toString() || ''
    const calledNumber = url.searchParams.get('calledNumber') || form?.get('To')?.toString() || GOOGLE_ADS_PHONE_NUMBER
    const callSid = url.searchParams.get('callSid') || form?.get('CallSid')?.toString() || ''

    const routing = getAgentRouting(calledNumber)
    const lead = from
      ? await resolveGoogleAdsLeadContext(from)
      : { leadId: null, leadName: null, created: false }

    if (from) {
      await notifyGoogleAdsTeam(
        googleAdsNewCallTeamMessage(from, lead.leadId),
        {
          leadId: lead.leadId,
          routing,
          trigger: 'google_ads_inbound_call_started',
          metadata: {
            direction: 'outbound_alert',
            from,
            calledNumber,
            callSid,
          },
        },
      )
    }

    const dialAction = `${BASE_URL}/api/ivr/dial-result?from=${esc(from)}&amp;leadId=${esc(lead.leadId || '')}&amp;calledNumber=${esc(calledNumber)}&amp;type=google_ads`
    const whisperBase = `${BASE_URL}/api/ivr/whisper?type=google_ads&amp;from=${esc(from)}&amp;leadId=${esc(lead.leadId || '')}&amp;calledNumber=${esc(calledNumber)}`
    const recordingCallback = `${BASE_URL}/api/twilio-recording-callback?source=google_ads_phone&amp;from=${esc(from)}&amp;leadId=${esc(lead.leadId || '')}&amp;calledNumber=${esc(calledNumber)}&amp;callSid=${esc(callSid)}`

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${dialAction}" method="POST" timeout="10" callerId="${calledNumber}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST">
    <Number url="${whisperBase}&amp;agent=${esc(routing.primary.name)}">${routing.primary.phone}</Number>
    <Number url="${whisperBase}&amp;agent=${esc(routing.secondary.name)}">${routing.secondary.phone}</Number>
  </Dial>
</Response>`

    return xmlResponse(twiml)
  } catch (error) {
    console.error('[IVR/google-ads] Critical error:', error)
    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="10">
    <Number>${getAgentRouting(GOOGLE_ADS_PHONE_NUMBER).primary.phone}</Number>
  </Dial>
</Response>`
    return xmlResponse(emergencyTwiml)
  }
}
