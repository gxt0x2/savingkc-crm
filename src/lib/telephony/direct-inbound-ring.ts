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

export function directInboundClientNoun(calledNumber: string | null | undefined): string {
  const identity = directInboundClientIdentity(calledNumber)
  if (!identity || /[^a-z0-9_-]/i.test(identity)) return ''
  return `<Client>${identity}</Client>`
}
