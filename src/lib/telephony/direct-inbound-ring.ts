import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'

/**
 * +18166088588 is Ernest's company DID and his default outbound caller ID.
 * Inbound to that DID is a direct ring. Seller-IVR <Dial> legs also use it as
 * callerId, so a personal-cell child shows on iPhone as a call from the
 * contact saved as Ernest. In-app rings use the PSTN From instead.
 */
export const ERNEST_COMPANY_DID = '+18166088588'
export const ERNEST_DISPOSITIONS_DID = '+18166088858'
/** Public Saving KC business line. Not an outbound caller-ID substitute. */
export const ERNEST_BUSINESS_DID = '+18164292900'
export const CASEY_COMPANY_DID = '+18167277667'
export const CASEY_LEGACY_DID = '+18163754666'

const ERNEST_DIRECT_DIDS = new Set([ERNEST_COMPANY_DID, ERNEST_DISPOSITIONS_DID])
const CASEY_DIRECT_DIDS = new Set([CASEY_COMPANY_DID, CASEY_LEGACY_DID])

export type InboundRingPlan = {
  kind: 'direct' | 'passthrough'
  identity: string | null
  cell: string | null
  /**
   * True when this ring has no personal-cell leg.
   * Ernest and Casey company DIDs dial the cell unless MOBILE_PERSONAL_FORWARD=false.
   * +18164292900 dials the cell only when that flag is exactly "true".
   * "false" never falls back to PSTN, including when the Voice client is down.
   */
  personalForwardSuppressed: boolean
}

function mobileFlag(name: 'MOBILE_IN_APP_VOICE' | 'MOBILE_PERSONAL_FORWARD'): boolean | null {
  const value = (process.env[name] ?? '').trim().toLowerCase()
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function ernestPersonalCell(): string {
  return normalizePhoneToE164(process.env.ERNEST_PHONE) || '+18162262552'
}

function caseyPersonalCell(): string {
  return normalizePhoneToE164(process.env.CASEY_PHONE) || '+18167564943'
}

/**
 * How an inbound company DID rings.
 * Casey's company and legacy DIDs follow Ernest's company and dispositions
 * DIDs: client identity unless MOBILE_IN_APP_VOICE=false, and the personal
 * cell unless MOBILE_PERSONAL_FORWARD=false. +18164292900 leaves the seller
 * IVR only when MOBILE_IN_APP_VOICE=true, and then dials Ernest's cell only
 * when personal forward is explicitly true.
 */
export function inboundRingPlan(calledNumber: string | null | undefined): InboundRingPlan {
  const number = normalizePhoneToE164(calledNumber)
  const inApp = mobileFlag('MOBILE_IN_APP_VOICE')
  const personal = mobileFlag('MOBILE_PERSONAL_FORWARD')
  const none = { kind: 'passthrough' as const, identity: null, cell: null, personalForwardSuppressed: false }
  if (!number) return none

  const caseyDirect = CASEY_DIRECT_DIDS.has(number)
  const ernestDirect = ERNEST_DIRECT_DIDS.has(number)
  const ernestBusiness = number === ERNEST_BUSINESS_DID && inApp === true
  if (!caseyDirect && !ernestDirect && !ernestBusiness) return none

  const ownerEmail = caseyDirect ? 'casey@savingkc.com' : 'ernest@savingkc.com'
  const identity = inApp === false ? null : resolveAgentTelephonyProfile(ownerEmail).identity
  const cell = (caseyDirect || ernestDirect)
    ? (personal === false ? null : (caseyDirect ? caseyPersonalCell() : ernestPersonalCell()))
    : (personal === true ? ernestPersonalCell() : null)

  return {
    kind: 'direct',
    identity,
    cell,
    personalForwardSuppressed: cell === null,
  }
}

/** Voice SDK identity for a company DID, or null when that DID does not ring a client. */
export function directInboundClientIdentity(calledNumber: string | null | undefined): string | null {
  return inboundRingPlan(calledNumber).identity
}

/** Company DIDs whose inbound call activity belongs on this Voice identity's Recents. */
export function ownedInboundCompanyNumbers(identity: string | null | undefined): readonly string[] {
  const normalized = identity?.trim().toLowerCase().replace(/^client:/, '') ?? ''
  if (normalized === 'ernest') return [ERNEST_COMPANY_DID, ERNEST_DISPOSITIONS_DID, ERNEST_BUSINESS_DID]
  if (normalized === 'casey') return [CASEY_COMPANY_DID]
  return []
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
