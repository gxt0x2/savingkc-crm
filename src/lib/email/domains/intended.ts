/** Primary business domain. Never a campaign sender. */
export const PRIMARY_BUSINESS_DOMAIN = 'savingkc.com'

/**
 * Owner-purchased outreach domains (Cloudflare Registrar, 2026-09-13).
 * Robin landed Resend domain add + Cloudflare DNS-only email records.
 * This catalog records that ops snapshot. It does not wire a product API key,
 * unlock live send, or write DNS from this VM. `savingkc.com` is unchanged.
 */
export type OpsResendVerify = 'verified' | 'partial'
export type OpsReceiveCapability = 'enabled' | 'pending'

export type IntendedOutreachDomain = {
  name: string
  registrarOwned: true
  nameserversOnCloudflare: true
  cloudflareDnsWritten: true
  resendDomainAdded: true
  emailAuthenticationReady: boolean
  receivingMxReady: boolean
  resendVerify: OpsResendVerify
  sendCapability: 'verified'
  receiveCapability: OpsReceiveCapability
  sendingReady: false
}

/** Shared CF DNS-only pattern Robin applied. Not product-owned records. */
export const OPS_EMAIL_DNS_PATTERN = {
  dkim: 'TXT resend._domainkey',
  bounceMx: 'MX send → feedback-smtp.us-east-1.amazonses.com p10',
  spf: 'TXT send SPF amazonses',
  dmarc: 'TXT _dmarc p=none',
  inboundMx: 'MX @ → inbound-smtp.us-east-1.amazonaws.com p10',
} as const

const OPS_BASE = {
  registrarOwned: true,
  nameserversOnCloudflare: true,
  cloudflareDnsWritten: true,
  resendDomainAdded: true,
  sendCapability: 'verified',
  sendingReady: false,
} as const

export const INTENDED_OUTREACH_DOMAINS: readonly IntendedOutreachDomain[] = [
  {
    name: 'talktosavingkc.com',
    ...OPS_BASE,
    emailAuthenticationReady: true,
    receivingMxReady: true,
    resendVerify: 'verified',
    receiveCapability: 'enabled',
  },
  {
    name: 'savingkcteam.com',
    ...OPS_BASE,
    emailAuthenticationReady: true,
    receivingMxReady: true,
    resendVerify: 'partial',
    receiveCapability: 'pending',
  },
  {
    name: 'yourkchomebuyer.com',
    ...OPS_BASE,
    emailAuthenticationReady: true,
    receivingMxReady: true,
    resendVerify: 'verified',
    receiveCapability: 'enabled',
  },
]

export function intendedOutreachDomainNames() {
  return INTENDED_OUTREACH_DOMAINS.map((domain) => domain.name)
}

export function isIntendedOutreachDomain(value: string) {
  return INTENDED_OUTREACH_DOMAINS.some(
    (domain) => domain.name === value.trim().toLowerCase(),
  )
}

export function intendedOutreachReadiness(domain: IntendedOutreachDomain) {
  return {
    registrarOwned: domain.registrarOwned,
    nameserversOnCloudflare: domain.nameserversOnCloudflare,
    cloudflareDnsWritten: domain.cloudflareDnsWritten,
    dnsReady: domain.cloudflareDnsWritten && domain.emailAuthenticationReady,
    resendAdded: domain.resendDomainAdded,
    resendVerify: domain.resendVerify,
    receivingEnabled: domain.receiveCapability === 'enabled',
    sendingReady: false as const,
  }
}

export function intendedOutreachStatusPhrase(domain: IntendedOutreachDomain) {
  if (
    domain.resendVerify === 'verified' &&
    domain.receiveCapability === 'enabled'
  ) {
    return 'Resend verified, send and receive'
  }
  if (domain.receiveCapability === 'pending') {
    return 'send verified, receive pending'
  }
  return 'send verified, receive enabled, Resend rechecking or partial'
}

export function intendedOutreachOpsLabel(domain: IntendedOutreachDomain) {
  return `${domain.name} — Cloudflare DNS-only records in place; ${intendedOutreachStatusPhrase(domain)}. Sending stays off until the Email product API key and release auth.`
}

/** Short ops snapshot for readiness copy. Not product readiness. */
export function intendedOutreachOpsBrief() {
  const full = INTENDED_OUTREACH_DOMAINS.filter(
    (domain) =>
      domain.resendVerify === 'verified' &&
      domain.receiveCapability === 'enabled',
  ).map((domain) => domain.name)
  const pending = INTENDED_OUTREACH_DOMAINS.filter(
    (domain) => domain.receiveCapability === 'pending',
  ).map((domain) => domain.name)
  const parts: string[] = []
  if (full.length) parts.push(`${full.join(' and ')} send+receive verified`)
  if (pending.length)
    parts.push(`${pending.join(' and ')} send verified / receive pending`)
  return parts.join('; ')
}

/** Ops DNS is not product readiness. Live send stays gated. */
export function outreachSendingUnlocked() {
  return INTENDED_OUTREACH_DOMAINS.some((domain) => domain.sendingReady)
}
