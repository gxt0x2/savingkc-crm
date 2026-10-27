import { NextResponse } from 'next/server'
import { isGoogleAdsPhoneNumber } from '@/lib/call-quality-events'
import { DIALER_CALLER_ID_NUMBERS as TWILIO_NUMBERS, COLD_CALL_CALLBACK_NUMBERS } from '@/lib/twilio-numbers'
import { dialTimeoutFallbackForSource, parseDialTimeout } from '@/lib/ring-timeout'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { readPhoneEnv } from '@/lib/phone-config'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import {
  directInboundClientNoun,
  inboundClientDialCallerId,
  inboundRingPlan,
} from '@/lib/telephony/direct-inbound-ring'
import { lookupInboundCallerName } from '@/lib/telephony/inbound-caller-name'
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

const TWILIO_PHONE = readPhoneEnv('TWILIO_PHONE_NUMBER', '+18163077835')
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com'
const ERNEST_PHONE = normalizePhoneToE164(process.env.ERNEST_PHONE) || '+18162262552'

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

// Cold call outbound dialing numbers — callbacks get a different IVR.
const COLD_CALL_NUMBERS = new Set<string>(COLD_CALL_CALLBACK_NUMBERS.map((number) => number.value))

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

function inboundClientStatusCallback(): string {
  return new URL('/api/twilio-inbound-client-status', BASE_URL).toString()
}

function voicemailRedirect(from: string, calledNumber: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${BASE_URL}/api/ivr/voicemail?agent=Ernest&amp;from=${encodeURIComponent(from)}&amp;leadId=&amp;calledNumber=${encodeURIComponent(calledNumber)}</Redirect>
</Response>`
}

function directInboundTwiml(input: {
  from: string
  calledNumber: string
  identity: string | null
  cell: string | null
  callerName?: string
}): string {
  const ringsClient = Boolean(input.identity)
  const clientNoun = directInboundClientNoun(input.calledNumber, ringsClient ? {
    statusCallback: inboundClientStatusCallback(),
    callerNumber: input.from,
    callerName: input.callerName ?? '',
    calledNumber: input.calledNumber,
  } : undefined)
  const cellNoun = input.cell
    ? `<Number url="${BASE_URL}/api/ivr/whisper?type=direct&amp;from=${encodeURIComponent(input.from)}&amp;calledNumber=${encodeURIComponent(input.calledNumber)}">${input.cell}</Number>`
    : ''
  const callerId = inboundClientDialCallerId({
    from: input.from,
    calledNumber: input.calledNumber,
    ringsClient,
  })
  // Client rings get 60s for CallKit. Cell-only company lines stay at 15s.
  // No-answer uses the Dial action, which sends the caller to voicemail.
  // That path does not add a personal cell when the cell noun is omitted.
  const dialTimeout = ringsClient ? 60 : 15
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${BASE_URL}/api/ivr/dial-result?from=${encodeURIComponent(input.from)}&amp;leadId=&amp;calledNumber=${encodeURIComponent(input.calledNumber)}&amp;type=direct" method="POST" timeout="${dialTimeout}" callerId="${callerId}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${BASE_URL}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    ${clientNoun}${cellNoun}
  </Dial>
</Response>`
}

function outboundStatusCallback(
  identity: string,
  clientAttemptId: string | null,
  source: string | null,
): string {
  const callback = new URL('/api/twilio-call-status', BASE_URL)
  callback.searchParams.set('identity', identity)
  if (clientAttemptId) callback.searchParams.set('clientAttemptId', clientAttemptId)
  // source lets a later hangup tell a mobile leg from a web dialer leg that
  // shares the same Twilio client identity.
  if (source) callback.searchParams.set('source', source)
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
    policyVersion: 'dialer_safety_v2',
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
  let inboundFrom = ''
  let inboundTo = ''
    let outboundContext: OutboundDialerCallInput = {
      phone: '',
      surface: 'automation',
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
    inboundFrom = from
    inboundTo = to

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
          surface: claims.surface,
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

        // The phone sends its own attempt id. It has to be the one inside the
        // signed intent. A different id must not be written onto this call.
        const suppliedAttemptId = getFormString(body, ['ClientAttemptId', 'clientAttemptId', 'client_attempt_id'])
        if (suppliedAttemptId && suppliedAttemptId !== clientAttemptId) {
          return blockOutboundCall(blockedDecision({
            reason: 'destination_mismatch',
            reasonSource: 'intent.attempt_mismatch',
            message: 'The approved call does not match this dial attempt.',
            normalizedPhone: sanitizedTo,
            leadId,
            prospectId,
            prospectPhoneId,
          }), outboundContext)
        }
      }

      const policyInput: OutboundDialerCallInput = {
        phone: sanitizedTo,
        surface: intentVerification?.valid ? intentVerification.claims.surface : 'automation',
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

      const statusCallback = outboundStatusCallback(identity, clientAttemptId, source)
      const recordingCallback = outboundRecordingCallback({ leadId, clientAttemptId, source })
      // Manual calls need time for a person (or their voicemail) to answer.
      // Keep explicit campaign ring counts and the legacy fallback intact.
      const dialTimeout = parseDialTimeout(
        getFormString(body, ['RingCount', 'ringCount', 'ring_count']),
        dialTimeoutFallbackForSource(source),
      )
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${callerId}" timeout="${dialTimeout}" answerOnBridge="true" ringTone="us" record="record-from-answer-dual" recordingStatusCallback="${recordingCallback}" recordingStatusCallbackMethod="POST">
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

    // Ernest company DIDs and, when in-app voice is on, +18164292900.
    // MOBILE_PERSONAL_FORWARD=false omits the personal cell. An unanswered
    // client goes to voicemail through dial-result and is not sent to PSTN.
    const ringPlan = inboundRingPlan(to)
    if (ringPlan.kind === 'direct') {
      if (!ringPlan.identity && !ringPlan.cell) {
        console.info('[IVR] Inbound has no client and personal forward is off', { calledNumber: to })
        return xmlResponse(voicemailRedirect(from, to))
      }
      if (ringPlan.personalForwardSuppressed) {
        console.info('[IVR] Personal cell omitted', { calledNumber: to, identity: ringPlan.identity })
      }
      let callerName = ''
      if (ringPlan.identity) {
        try {
          callerName = await lookupInboundCallerName(from)
        } catch {
          // The client still rings. CallKit falls through to the PSTN number.
          console.error('[IVR] Inbound caller name lookup failed')
        }
      }
      return xmlResponse(directInboundTwiml({
        from,
        calledNumber: to,
        identity: ringPlan.identity,
        cell: ringPlan.cell,
        callerName,
      }))
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

    const ringPlan = inboundRingPlan(inboundTo)
    if (ringPlan.kind === 'direct' && ringPlan.personalForwardSuppressed) {
      if (!ringPlan.identity) return xmlResponse(voicemailRedirect(inboundFrom, inboundTo))
      return xmlResponse(directInboundTwiml({
        from: inboundFrom,
        calledNumber: inboundTo,
        identity: ringPlan.identity,
        cell: null,
      }))
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
