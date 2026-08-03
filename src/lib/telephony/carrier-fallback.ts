import { normalizePhoneToE164 } from '@/lib/phone-normalize'

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
}): string {
  const baseUrl = (input.baseUrl || crmBaseUrl()).replace(/\/$/, '')
  const from = normalizePhoneToE164(input.from) || input.from
  const calledNumber = normalizePhoneToE164(input.calledNumber) || input.calledNumber
  const agentPhone = normalizePhoneToE164(input.agentPhone) || input.agentPhone
  const action = `${baseUrl}/api/ivr/dial-result?from=${encodeURIComponent(from)}&leadId=&calledNumber=${encodeURIComponent(calledNumber)}&type=direct`
  const recordingCallback = `${baseUrl}/api/twilio-recording-callback?source=carrier_fallback&from=${encodeURIComponent(from)}&calledNumber=${encodeURIComponent(calledNumber)}`

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial action="${xmlEscape(action)}" method="POST" timeout="15" callerId="${xmlEscape(calledNumber)}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${xmlEscape(recordingCallback)}" recordingStatusCallbackMethod="POST">
    <Number>${xmlEscape(agentPhone)}</Number>
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

export function buildCarrierFallbackSmsTask(input: {
  from: string
  to: string
  assignedAgent: string
  messageSid: string
}) {
  return {
    activity_type: 'task',
    description: `Review carrier fallback SMS from ${input.from}`,
    agent: 'System',
    metadata: {
      source: 'carrier_sms_fallback',
      message_sid: input.messageSid,
      called_number: input.to,
      task_type: 'reply',
      due_date: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      assigned_to: input.assignedAgent,
      priority: 'high',
      status: 'pending',
    },
  }
}
