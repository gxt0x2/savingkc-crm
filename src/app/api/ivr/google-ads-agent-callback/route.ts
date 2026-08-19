import { NextResponse } from 'next/server'
import { GOOGLE_ADS_PHONE_NUMBER, getGoogleAdsPhoneProfile } from '@/lib/call-quality-events'
import { callerPhoneLabel } from '@/lib/google-ads-phone'
import { evaluateOutboundDialerCall, recordBlockedDialerCall } from '@/lib/server/dialer-call-eligibility'
import { validateTwilioWebhook } from '@/lib/twilio-validate'

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
  let signatureIsValid = false
  try {
    signatureIsValid = await validateTwilioWebhook(req)
  } catch (error) {
    console.error('[IVR/google-ads-agent-callback] Twilio signature validation failed:', error)
  }
  if (!signatureIsValid) {
    return xmlResponse('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>', 403)
  }
  const url = new URL(req.url)
  const leadId = url.searchParams.get('leadId') || ''
  const leadPhone = url.searchParams.get('leadPhone') || ''
  const calledNumber = url.searchParams.get('calledNumber') || GOOGLE_ADS_PHONE_NUMBER
  const agentName = url.searchParams.get('agentName') || 'agent'
  const triggerCallSid = url.searchParams.get('triggerCallSid') || ''
  const profile = getGoogleAdsPhoneProfile(calledNumber)

  if (!leadPhone) {
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Google Ads callback failed. No lead phone number was available.</Say>
  <Hangup/>
</Response>`)
  }

  const form = await req.formData().catch(() => null)
  const agentCallSid = form?.get('CallSid')?.toString() || ''
  const policyInput = {
    phone: leadPhone,
    leadId: leadId || null,
    prospectPhoneId: null,
    source: 'google_ads_callback' as const,
    identity: agentName,
    callerId: calledNumber,
    callSid: agentCallSid,
    clientAttemptId: triggerCallSid || null,
  }
  const policy = await evaluateOutboundDialerCall(policyInput)
  if (!policy.allowed) {
    await recordBlockedDialerCall(policyInput, policy)
    return xmlResponse(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Call blocked by contact policy. Review the contact record.</Say>
  <Hangup/>
</Response>`)
  }

  const resultAction = `${BASE_URL}/api/ivr/google-ads-agent-callback-result?leadId=${esc(leadId)}&amp;leadPhone=${esc(leadPhone)}&amp;calledNumber=${esc(calledNumber)}&amp;agentName=${esc(agentName)}&amp;triggerCallSid=${esc(triggerCallSid)}`
  const recordingCallback = `${BASE_URL}/api/twilio-recording-callback?source=${esc(profile.source)}&amp;from=${esc(policy.normalizedPhone)}&amp;leadId=${esc(leadId)}&amp;calledNumber=${esc(calledNumber)}&amp;callSid=${esc(triggerCallSid)}`
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Google Ads lead callback. Calling ${callerPhoneLabel(policy.normalizedPhone)} now.</Say>
  <Dial action="${resultAction}" method="POST" timeout="20" callerId="${calledNumber}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST">
    <Number>${policy.normalizedPhone}</Number>
  </Dial>
</Response>`

  return xmlResponse(twiml)
}
