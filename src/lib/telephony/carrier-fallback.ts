import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import {
  directInboundClientNoun,
  inboundClientDialCallerId,
  inboundRingPlan,
} from '@/lib/telephony/direct-inbound-ring'

export const VOICE_FALLBACK_PATH = '/api/twilio/fallback/voice'
export const SMS_FALLBACK_PATH = '/api/twilio/fallback/sms'

export function crmBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://crm.savingkc.com').replace(/\/$/, '')
}

export function carrierFallbackUrls(baseUrl = crmBaseUrl()) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/, '')
  return {
    voice: `${normalizedBaseUrl}${VOICE_FALLBACK_PATH}`,
    sms: `${normalizedBaseUrl}${SMS_FALLBACK_PATH}`,
  }
}

export function matchesCarrierRoute(value: string | null | undefined, path: string): boolean {
  if (!value) return false
  try {
    return new URL(value).pathname === path
  } catch {
    return value.endsWith(path)
  }
}

function xmlEscape(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

export function emptyTwiml(): string {
  return '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'
}

export function buildCarrierVoiceFallbackTwiml(input: {
  baseUrl?: string
  from: string
  calledNumber: string
  agentPhone: string
  callerName?: string | null
}): string {
  const baseUrl = (input.baseUrl || crmBaseUrl()).replace(/\/$/, '')
  const from = normalizePhoneToE164(input.from) || input.from
  const calledNumber = normalizePhoneToE164(input.calledNumber) || input.calledNumber
  const agentPhone = normalizePhoneToE164(input.agentPhone) || input.agentPhone
  const action = `${baseUrl}/api/ivr/dial-result?from=${encodeURIComponent(from)}&leadId=&calledNumber=${encodeURIComponent(calledNumber)}&type=direct`
  const recordingCallback = `${baseUrl}/api/twilio-recording-callback?source=carrier_fallback&from=${encodeURIComponent(from)}&calledNumber=${encodeURIComponent(calledNumber)}`
  const plan = inboundRingPlan(calledNumber)
  const ringsClient = Boolean(plan.identity)
  const clientNoun = directInboundClientNoun(calledNumber, ringsClient ? {
    callerNumber: from,
    callerName: input.callerName ?? '',
    calledNumber,
  } : undefined)
  // Direct company DIDs obey the personal-forward flag. A suppressed cell is
  // not put back on this fallback. Every other line keeps the owning agent.
  const cell = plan.kind === 'direct' && plan.personalForwardSuppressed ? null : agentPhone
  const callerId = inboundClientDialCallerId({ from, calledNumber, ringsClient })
  if (!clientNoun && !cell) {
    const voicemail = `${baseUrl}/api/ivr/voicemail?agent=Ernest&from=${encodeURIComponent(from)}&leadId=&calledNumber=${encodeURIComponent(calledNumber)}`
    return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${xmlEscape(voicemail)}</Redirect>
</Response>`
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${xmlEscape(action)}" method="POST" timeout="15" callerId="${xmlEscape(callerId)}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(recordingCallback)}" recordingStatusCallbackMethod="POST">
    ${clientNoun}${cell ? `<Number>${xmlEscape(cell)}</Number>` : ''}
  </Dial>
</Response>`
}

export function buildCarrierFallbackSmsLeadSeed(input: {
  from: string
  to: string
  assignedAgent: string
  messageSid: string
}) {
  return {
    full_name: `New texter · ${input.from}`,
    phone: normalizePhoneToE164(input.from) || input.from,
    source: 'inbound_sms',
    station: 'new',
    priority: 'warm',
    classification: null,
    assigned_agent: input.assignedAgent,
    notes: `Inbound SMS was captured by the carrier fallback on ${input.to}. MessageSid: ${input.messageSid}`,
  }
}
