import { ERNEST_BUSINESS_DID, inboundClientDialCallerId, ivrAgentClientNouns } from '@/lib/telephony/direct-inbound-ring'

/**
 * Inbound call flow for the public business line (816) 429-2900.
 *
 * Owner 11/07: the old flow played the menu once, waited 5 s, then rang cells
 * only, so a caller who did not press a key heard the call "abruptly end".
 * This sequence never leaves a caller in silence and never hangs up on a
 * person without telling them what happens next. The same flow serves every
 * menu line (429-2900 and any company line not tied to Ernest, Casey or Gertha):
 *
 *   0. Normal US ringback for 15 s (owner 11/07), then the menu.
 *   1. Menu: sell (1), everything else (2), stop calls (9). 7 s to answer.
 *   2. No key or a wrong key: one shorter retry that says staying on the line
 *      connects them.
 *   3. Still nothing: connect to the team anyway (no-input route).
 *   4. Before ringing: "Thanks, connecting you now." Then the apps and cells
 *      ring together with normal ringback for up to 30 s (25 s cells only).
 *   5. Nobody answers: the agent's voicemail greeting, record, "Thank you."
 *   9. Removal: on the do-not-call list (calls and texts), confirmation, hang up.
 *
 * One voice reads every caller-facing line: ElevenLabs "Cecily - Pro Black
 * Woman Voice Over" (owner 11/07) through Twilio <Say> (ElevenLabs public
 * beta). IVR_VOICE overrides it without a code change, e.g. Polly.Joanna-Neural
 * if Twilio ever rejects the ElevenLabs voice.
 */
export const CECILY_VOICE = 'ElevenLabs.NQMJRVvPew6HsaebYnZj'
export const FALLBACK_VOICE = 'Polly.Joanna-Neural'

export function menuVoice(env: NodeJS.ProcessEnv = process.env): string {
  return env.IVR_VOICE?.trim() || CECILY_VOICE
}

/** Caller-facing <Say> in the menu voice. */
export function sayMenu(text: string): string {
  return `<Say voice="${menuVoice()}" language="en-US">${text}</Say>`
}

/** 15 s of standard US ringback (2 s on, 4 s off) before the menu answers. */
export const PRE_MENU_RING_SECONDS = 15
export const PRE_MENU_RING_FILE = 'ring-15s.wav'

export const BUSINESS_MENU_PROMPT = "Thanks for calling Saving KC Homebuyers. If you're calling about selling a house, press 1. For everything else, press 2 to speak with a member of our team. To be removed from our call list, press 9."
export const BUSINESS_MENU_RETRY_PROMPT = "Sorry, I didn't catch that. To talk about selling a house, press 1. For everything else, press 2. Or just stay on the line, and we'll connect you."
export const CONNECTING_PROMPT = 'Thanks. Connecting you now.'
export const OPT_OUT_PROMPT = "You've been removed from our call list, and we won't call or text this number again. Thank you, and have a great day."

export const MENU_GATHER_TIMEOUT_SECONDS = 7

export function isBusinessLine(calledNumber: string | null | undefined): boolean {
  return calledNumber === ERNEST_BUSINESS_DID
}

function query(params: Record<string, string>): string {
  return Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&amp;')
}

export function businessMenuTwiml(input: {
  baseUrl: string
  from: string
  callSid: string
  calledNumber: string
  attempt: 1 | 2
}): string {
  const params = { from: input.from, callSid: input.callSid, calledNumber: input.calledNumber }
  const prompt = input.attempt === 1 ? BUSINESS_MENU_PROMPT : BUSINESS_MENU_RETRY_PROMPT
  const next = input.attempt === 1
    ? `${input.baseUrl}/api/ivr/business-menu?${query({ ...params, attempt: '2' })}`
    : `${input.baseUrl}/api/ivr/no-input?${query({ from: input.from, calledNumber: input.calledNumber })}`
  // Ringback sits outside the Gather, so only the first pass rings and a key
  // pressed while it rings is ignored.
  const ring = input.attempt === 1 ? `\n  <Play>${input.baseUrl}/api/audio/${PRE_MENU_RING_FILE}</Play>` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${ring}
  <Gather numDigits="1" action="${input.baseUrl}/api/ivr/handle-input?${query(params)}" method="POST" timeout="${MENU_GATHER_TIMEOUT_SECONDS}">
    ${sayMenu(prompt)}
  </Gather>
  <Redirect method="POST">${next}</Redirect>
</Response>`
}

export function optOutTwiml(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${sayMenu(OPT_OUT_PROMPT)}
  <Hangup />
</Response>`
}

export type AgentDialType = 'seller' | 'non_seller' | 'no_input'

/**
 * Rings the agents' SavingKC apps together with their cells (owner 11/06: the
 * app, cells as backup); first to answer gets the call. Cold callbacks keep
 * cells only and no spoken line, so their unbranded script stays intact.
 * A Voice client must present the caller's number so CallKit shows the seller.
 */
export function agentDialTwiml(input: {
  baseUrl: string
  from: string
  calledNumber: string
  companyNumber: string
  leadId: string
  type: AgentDialType
  cells: string[]
  ringApps: boolean
  announce: boolean
}): string {
  const whisperType = input.type === 'no_input' ? 'call' : input.type
  const whisperLead = input.type === 'non_seller' ? '' : `&amp;leadId=${encodeURIComponent(input.leadId)}`
  const whisper = `${input.baseUrl}/api/ivr/whisper?type=${whisperType}&amp;from=${encodeURIComponent(input.from)}${whisperLead}`
  const clients = input.ringApps ? ivrAgentClientNouns(input.calledNumber, {
    statusCallback: `${input.baseUrl}/api/twilio-inbound-client-status`,
    callerNumber: input.from,
    callerName: '',
    calledNumber: input.calledNumber,
  }) : ''
  const callerId = clients
    ? inboundClientDialCallerId({ from: input.from, calledNumber: input.companyNumber, ringsClient: true })
    : input.companyNumber
  // CallKit needs longer than a cell to wake a locked phone. Either way the
  // caller hears ringback for the whole window, then voicemail.
  const timeout = clients ? 30 : 25
  const numbers = input.cells.map((cell) => `<Number url="${whisper}">${cell}</Number>`).join('\n    ')
  const announce = input.announce ? `\n  ${sayMenu(CONNECTING_PROMPT)}` : ''
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>${announce}
  <Dial action="${input.baseUrl}/api/ivr/dial-result?from=${encodeURIComponent(input.from)}&amp;leadId=${encodeURIComponent(input.leadId)}&amp;calledNumber=${encodeURIComponent(input.calledNumber)}&amp;type=${input.type}" method="POST" timeout="${timeout}" callerId="${callerId}" answerOnBridge="true" record="record-from-answer-dual" recordingStatusCallback="${input.baseUrl}/api/twilio-recording-callback" recordingStatusCallbackMethod="POST">
    ${clients}${numbers}
  </Dial>
</Response>`
}
