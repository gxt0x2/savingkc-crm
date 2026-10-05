import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

/** Company lines that should ring Ernest's Voice client and his cell together. */
const ERNEST_COMPANY_NUMBERS = new Set(['+18166088588', '+18166088858'])

/**
 * Voice SDK identity for a company DID.
 * Only Ernest's company and dispositions lines have a registered client identity.
 * The cellular leg stays until a device proves VoIP push registration.
 */
export function directInboundClientIdentity(calledNumber: string | null | undefined): string | null {
  const normalized = normalizePhoneToE164(calledNumber)
  if (!normalized || !ERNEST_COMPANY_NUMBERS.has(normalized)) return null
  return resolveAgentTelephonyProfile('ernest@savingkc.com').identity
}

export type DirectInboundClientNounOptions = {
  statusCallback?: string | null
  /** PSTN From. Sent as the callerNumber parameter when caller context is requested. */
  callerNumber?: string | null
  /** CRM contact name. An empty value is sent when no displayable name exists. */
  callerName?: string | null
  /** Company DID. Falls back to the called-number argument. */
  calledNumber?: string | null
}

function xmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

/**
 * Names created by intake ("New caller · …", "Inbound Seller") are not a
 * person. CallKit should fall through to the PSTN number instead.
 */
export function inboundCallerDisplayName(value: string | null | undefined): string {
  const name = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!name) return ''
  if (/^(?:unknown(?: caller)?|inbound\b.*|new caller\b.*|new texter\b.*|voicemail caller\b.*|missed call\b.*|cold callback\b.*|sms lead\b.*|caller\b.*)$/i.test(name)) {
    return ''
  }
  return name.slice(0, 80).trim()
}

function hasCallerContext(options: DirectInboundClientNounOptions | undefined): boolean {
  return Boolean(options) && (
    options?.callerNumber !== undefined
    || options?.callerName !== undefined
    || options?.calledNumber !== undefined
  )
}

function clientParameters(
  calledNumber: string | null | undefined,
  options: DirectInboundClientNounOptions,
): string {
  const callerNumber = normalizePhoneToE164(options.callerNumber) || ''
  const companyNumber = normalizePhoneToE164(options.calledNumber ?? calledNumber) || ''
  const callerName = inboundCallerDisplayName(options.callerName)
  return [
    `<Parameter name="callerNumber" value="${xmlAttribute(callerNumber)}" />`,
    `<Parameter name="callerName" value="${xmlAttribute(callerName)}" />`,
    `<Parameter name="calledNumber" value="${xmlAttribute(companyNumber)}" />`,
  ].join('')
}

/**
 * Dial callerId for a company-line ring.
 * A Voice client must present the PSTN From so CallKit's first paint (twi_from)
 * is the caller. Twilio accepts that calling number on a simultaneous <Number>.
 * Cell-only rings keep the company DID. A From that is not E.164 also keeps the
 * DID so the cell leg still has a caller ID Twilio will place.
 */
export function inboundClientDialCallerId(input: {
  from: string | null | undefined
  calledNumber: string
  ringsClient: boolean
}): string {
  const calledNumber = normalizePhoneToE164(input.calledNumber) || input.calledNumber
  if (!input.ringsClient) return calledNumber
  return normalizePhoneToE164(input.from) || calledNumber
}

export function directInboundClientNoun(
  calledNumber: string | null | undefined,
  options?: DirectInboundClientNounOptions,
): string {
  const identity = directInboundClientIdentity(calledNumber)
  if (!identity || /[^a-z0-9_-]/i.test(identity)) return ''
  const statusCallback = options?.statusCallback?.trim()
  const opening = statusCallback
    ? `<Client statusCallback="${xmlAttribute(statusCallback)}" statusCallbackEvent="initiated ringing answered completed" statusCallbackMethod="POST">`
    : '<Client>'
  if (!hasCallerContext(options)) return `${opening}${identity}</Client>`
  return `${opening}<Identity>${identity}</Identity>${clientParameters(calledNumber, options || {})}</Client>`
}
