import { NextResponse } from 'next/server'
import { isGoogleAdsPhoneNumber } from '@/lib/call-quality-events'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { parseDialTimeout } from '@/lib/ring-timeout'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { verifyDialerCallIntent } from '@/lib/telephony/dialer-call-intent'
import { validateTwilioWebhook } from '@/lib/twilio-validate'
import {
  evaluateOutboundDialerCall,
  recordBlockedDialerCall,
  type OutboundDialerCallInput,
  type OutboundDialerCallSource,
  type OutboundDialerCallDecision,
} from '@/lib/server/dialer-call-eligibility'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER || '+18163077835'
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const ERNEST_PHONE = normalizePhoneToE164(process.env.ERNEST_PHONE) || '+18162262552'
const CASEY_PHONE = normalizePhoneToE164(process.env.CASEY_PHONE) || '+18167564943'

const XML_HEADERS: HeadersInit = {
  'Content-Type': 'text/xml',
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

const ALLOWED_OUTBOUND_CALLER_IDS = new Set<string>(TWILIO_NUMBERS.map((n) => n.value))
const LEGACY_SDK_INTENT_SUNSET = Date.parse('2026-09-16T05:00:00.000Z')

type BlockedDialerCallDecision = Extract<OutboundDialerCallDecision, { allowed: false }>
type RequestKind = 'unknown' | 'outbound' | 'inbound'

const BLOCKED_OUTBOUND_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Call blocked by contact policy. Review the contact record.</Say>
  <Hangup/>
</Response>`

const EMPTY_TWIML = `<?xml version="1.0" encoding="UTF-8"?>
<Response><Hangup/></Response>`

// Company numbers that ring agent cell directly (no IVR)
const DIRECT_RING_NUMBERS: Record<string, string> = {
  '+18166088588': ERNEST_PHONE,
  '+18166088858': ERNEST_PHONE,
  '+18167277667': CASEY_PHONE,
  '+18163754666': CASEY_PHONE,
}

// Cold call outbound dialing numbers — callbacks get a different IVR
const COLD_CALL_NUMBERS = new Set([
  '+18163100845',
  '+18162538313',
  '+18164761344',
  '+18164761589',
  '+18166404701',
  '+18165788107',
  '+18166408032',
  '+18166536616',
])

function getFormString(body: FormData, keys: string[]): string | null {
  for (const key of keys) {
    const value = body.get(key)
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function xmlResponse(body: string, status = 200) {
  return new NextResponse(body, { status, headers: XML_HEADERS })
}

function outboundRecordingCallback(input: {
  leadId: string | null
  clientAttemptId: string | null
  source: OutboundDialerCallSource
}): string {
  const callback = new URL('/api/twilio-recording-callback', BASE_URL)
  if (input.leadId) callback.searchParams.set('leadId', input.leadId)
  if (input.clientAttemptId) callback.searchParams.set('clientAttemptId', input.clientAttemptId)
  callback.searchParams.set('source', input.source)
  return callback.toString().replaceAll('&', '&amp;')
}

function legacySdkIntentCompatibilityEnabled(now = new Date()): boolean {
  return process.env.DIALER_ALLOW_LEGACY_UNSIGNED_INTENTS === 'true'
    && now.getTime() < LEGACY_SDK_INTENT_SUNSET
}

function blockedDecision(input: {
  reason?: BlockedDialerCallDecision['reason']
  reasonSource: string
  message: string
  normalizedPhone?: string | null
  leadId?: string | null
  prospectId?: string | null
  prospectPhoneId?: string | null
}): BlockedDialerCallDecision {
  return {
    allowed: false,
    policyVersion: 'dialer_safety_v1',
    checkedAt: new Date().toISOString(),
    normalizedPhone: input.normalizedPhone ?? null,
    leadId: input.leadId ?? null,
    prospectId: input.prospectId ?? null,
    prospectPhoneId: input.prospectPhoneId ?? null,
    reason: input.reason ?? 'policy_unavailable',
    reasonSource: input.reasonSource,
    message: input.message,
  }
}

async function blockOutboundCall(
  decision: BlockedDialerCallDecision,
  policyInput: OutboundDialerCallInput,
) {
  try {
    await recordBlockedDialerCall(policyInput, decision)
  } catch (error) {
    // Recording is deliberately best-effort. A logging failure must never turn
    // a denied call into a PSTN leg.
    console.error('[IVR] Failed to record blocked outbound call:', error)
  }
  return xmlResponse(BLOCKED_OUTBOUND_TWIML)
}

export async function POST(req: Request) {
  let requestKind: RequestKind = 'unknown'
  let outboundContext: OutboundDialerCallInput = {
    phone: '',
    source: 'legacy_sdk',
    identity: null,
    callerId: null,
    callSid: null,
    leadId: null,
    prospectPhoneId: null,
    clientAttemptId: null,
  }

  try {
    if (!req.headers.get('x-twilio-signature')) {
      return xmlResponse('Forbidden', 403)
    }
    let signatureIsValid = false
    try {
      signatureIsValid = await validateTwilioWebhook(req)
    } catch (error) {
      console.error('[IVR] Twilio signature validation failed:', error)
    }
    if (!signatureIsValid) return xmlResponse('Forbidden', 403)

    const body = await req.formData()
    const callSid = getFormString(body, ['CallSid']) || ''
    const from = getFormString(body, ['From']) || ''
    const to = getFormString(body, ['To']) || ''

    // ── OUTBOUND: browser/SDK-initiated call ──
    if (from && from.startsWith('client:')) {
      requestKind = 'outbound'
      const identity = from.slice('client:'.length).trim().toLowerCase()
      const sanitizedTo = normalizePhoneToE164(to)
      const requestedCallerIdRaw = getFormString(body, ['CallerId', 'callerId', 'caller_id'])
      const requestedCallerId = normalizePhoneToE164(requestedCallerIdRaw)
      outboundContext = {
        ...outboundContext,
        phone: sanitizedTo ?? to,
        identity: identity || null,
        callSid: callSid || null,
      }
      const fallbackCallerId = resolveAgentTelephonyProfile(identity).defaultCallerId || TWILIO_PHONE
      const callerId = requestedCallerId || fallbackCallerId
      outboundContext = { ...outboundContext, callerId: callerId || null }

      if (!identity) {
        return blockOutboundCall(blockedDecision({
          reasonSource: 'intent.invalid_identity',
          message: 'The outbound caller identity is missing.',
          normalizedPhone: sanitizedTo,
        }), outboundContext)
      }

      if (!sanitizedTo) {
        return blockOutboundCall(blockedDecision({
          reasonSource: 'intent.invalid_destination',
          message: 'Enter a valid 10-digit US phone number.',
        }), outboundContext)
      }

      // An explicitly requested caller ID must be both syntactically valid and
      // present in the dialer-eligible inventory. Never silently substitute a
      // different line because that makes the UI and provider audit disagree.
      if (
        (requestedCallerIdRaw && !requestedCallerId)
        || !callerId
        || !ALLOWED_OUTBOUND_CALLER_IDS.has(callerId)
      ) {
        return blockOutboundCall(blockedDecision({
          reason: 'blocked_number',
          reasonSource: 'caller_id.unapproved',
          message: 'The selected outbound caller ID is not approved.',
          normalizedPhone: sanitizedTo,
        }), outboundContext)
      }

      const intentKeys = [
        'DialIntentToken',
        'CallIntent',
        'dialIntentToken',
        'dial_intent_token',
      ]
      const intentToken = getFormString(body, intentKeys)
      const intentWasSupplied = intentKeys.some((key) => body.has(key))
      const intentVerification = intentWasSupplied ? verifyDialerCallIntent(intentToken) : null

      let source: OutboundDialerCallSource = 'legacy_sdk'
      let leadId: string | null = null
      let prospectId: string | null = null
      let prospectPhoneId: string | null = null
      let clientAttemptId: string | null = null

      // A present but invalid, expired, or tampered token always fails closed.
      if (intentVerification && !intentVerification.valid) {
        return blockOutboundCall(blockedDecision({
          reasonSource: `intent.${intentVerification.reason}`,
          message: 'Call authorization is invalid or expired. Refresh the contact and retry.',
          normalizedPhone: sanitizedTo,
        }), outboundContext)
      }

      if (!intentWasSupplied && !legacySdkIntentCompatibilityEnabled()) {
        return blockOutboundCall(blockedDecision({
          reasonSource: 'intent.missing',
          message: 'Call authorization is required. Reconnect the dialer and retry.',
          normalizedPhone: sanitizedTo,
        }), outboundContext)
      }

      if (!intentWasSupplied) {
        console.warn('[IVR] Temporary legacy SDK intent compatibility was used')
      }

      if (intentVerification?.valid) {
        const { claims } = intentVerification
        source = claims.source
        leadId = claims.leadId
        prospectId = claims.prospectId
        prospectPhoneId = claims.prospectPhoneId
        clientAttemptId = claims.clientAttemptId
        outboundContext = {
          ...outboundContext,
          source,
          leadId,
          prospectId,
          prospectPhoneId,
          clientAttemptId,
        }

        const bodyLeadId = getFormString(body, ['LeadId', 'leadId', 'lead_id'])
        const bodyProspectId = getFormString(body, ['ProspectId', 'prospectId', 'prospect_id'])
        const bodyProspectPhoneId = getFormString(body, ['ProspectPhoneId', 'prospectPhoneId', 'prospect_phone_id'])
        const contextMismatch =
          claims.identity !== identity
          || claims.to !== sanitizedTo
          || claims.callerId !== callerId
          || Boolean(bodyLeadId && bodyLeadId !== claims.leadId)
          || Boolean(bodyProspectId && bodyProspectId !== claims.prospectId)
          || Boolean(bodyProspectPhoneId && bodyProspectPhoneId !== claims.prospectPhoneId)

        if (contextMismatch) {
          return blockOutboundCall(blockedDecision({
            reason: 'destination_mismatch',
            reasonSource: 'intent.claim_mismatch',
            message: 'The approved call does not match this destination or caller identity.',
            normalizedPhone: sanitizedTo,
            leadId,
            prospectId,
            prospectPhoneId,
          }), outboundContext)
        }
      }

      const policyInput: OutboundDialerCallInput = {
        phone: sanitizedTo,
        leadId,
        prospectId,
        prospectPhoneId,
        source,
        identity,
        callerId,
        callSid,
        clientAttemptId,
      }
      outboundContext = policyInput

      let decision: OutboundDialerCallDecision
      try {
        decision = await evaluateOutboundDialerCall(policyInput)
      } catch (error) {
        console.error('[IVR] Outbound call policy failed:', error)
        decision = blockedDecision({
          reasonSource: 'policy.unexpected_error',
          message: 'Calling is paused because the safety check is unavailable.',
          normalizedPhone: sanitizedTo,
          leadId,
          prospectId,
          prospectPhoneId,
        })
      }

      if (!decision.allowed) {
        return blockOutboundCall(decision, policyInput)
      }

      const statusCallback = `${BASE_URL}/api/twilio-call-status?identity=${encodeURIComponent(identity)}`
      const recordingCallback = outboundRecordingCallback({ leadId, clientAttemptId, source })
      const dialTimeout = parseDialTimeout(getFormString(body, ['RingCount', 'ringCount', 'ring_count']))
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="${dialTimeout}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST">
    <Number statusCallback="${statusCallback}" statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">${sanitizedTo}</Number>
  </Dial>
</Response>`
      return xmlResponse(twiml)
    }

    requestKind = 'inbound'

    // ── GOOGLE ADS: dedicated paid-search line, no generic IVR ──
    if (isGoogleAdsPhoneNumber(to)) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/google-ads?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`
      return xmlResponse(twiml)
    }

    // ── DIRECT RING: Company numbers ring agent cell (no IVR) ──
    if (DIRECT_RING_NUMBERS[to]) {
      const agentPhone = DIRECT_RING_NUMBERS[to]
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(from)}&amp;leadId=&amp;calledNumber=${encodeURIComponent(to)}&amp;type=direct" method="POST" timeout="15" callerId="${to}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    <Number url="${BASE_URL}/api/ivr/whisper?type=direct&amp;from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}">${agentPhone}</Number>
  </Dial>
</Response>`
      return xmlResponse(twiml)
    }

    // ── COLD CALL CALLBACK: different IVR — qualify before ringing agents ──
    if (COLD_CALL_NUMBERS.has(to)) {
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${BASE_URL}/api/ivr/handle-input?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}&amp;coldcall=1" method="POST" timeout="4">
    <Play>${BASE_URL}/api/audio/ivr-press1.mp3</Play>
  </Gather>
  <Redirect method="POST">${BASE_URL}/api/ivr/cold-no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`
      return xmlResponse(twiml)
    }

    // ── STANDARD INBOUND: ElevenLabs Jessica greeting ──
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather numDigits="1" action="${BASE_URL}/api/ivr/handle-input?from=${encodeURIComponent(from)}&amp;callSid=${encodeURIComponent(callSid)}&amp;calledNumber=${encodeURIComponent(to)}" method="POST" timeout="5">
    <Play>${BASE_URL}/api/audio/ivr-greeting.mp3</Play>
  </Gather>
  <Redirect method="POST">${BASE_URL}/api/ivr/no-input?from=${encodeURIComponent(from)}&amp;calledNumber=${encodeURIComponent(to)}</Redirect>
</Response>`

    return xmlResponse(twiml)
  } catch (error) {
    console.error('[IVR] Critical error in main handler:', error)
    if (requestKind === 'outbound') {
      return blockOutboundCall(blockedDecision({
        reasonSource: 'policy.unexpected_error',
        message: 'Calling is paused because the safety check is unavailable.',
      }), outboundContext)
    }

    // Preserve the historical emergency fallback only after a verified Twilio
    // request was successfully classified as inbound. Unknown/parse failures
    // must not create a call leg.
    if (requestKind !== 'inbound') {
      return xmlResponse(EMPTY_TWIML)
    }

    const emergencyTwiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="15">
    <Number>${ERNEST_PHONE}</Number>
  </Dial>
</Response>`
    return xmlResponse(emergencyTwiml)
  }
}
