/** Primary business domain. Never a campaign sender. */
export const PRIMARY_BUSINESS_DOMAIN = 'savingkc.com'

/**
 * Owner-purchased outreach domains (Cloudflare Registrar, 2026-09-13).
 * Robin landed Resend domain add + Cloudflare DNS-only email records.
 * This catalog records that ops snapshot. It does not wire a product API key,
 * unlock live send, or write DNS from this VM. `savingkc.com` is unchanged.
 */
export type OpsResendVerify = 'verified' | 'partial'

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
  receiveCapability: 'enabled'
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
  receiveCapability: 'enabled',
  sendingReady: false,
} as const

export const INTENDED_OUTREACH_DOMAINS: readonly IntendedOutreachDomain[] = [
  {
    name: 'talktosavingkc.com',
    ...OPS_BASE,
    emailAuthenticationReady: true,
    receivingMxReady: true,
    resendVerify: 'verified',
  },
  {
    name: 'savingkcteam.com',
    ...OPS_BASE,
    emailAuthenticationReady: true,
    receivingMxReady: true,
    resendVerify: 'partial',
  },
  {
    name: 'yourkchomebuyer.com',
    ...OPS_BASE,
    emailAuthenticationReady: true,
    receivingMxReady: true,
    resendVerify: 'partial',
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

export function intendedOutreachOpsLabel(domain: IntendedOutreachDomain) {
  const resend =
    domain.resendVerify === 'verified'
      ? 'Resend verified, send and receive'
      : 'send verified, receive enabled, Resend rechecking or partial'
  return `${domain.name} — Cloudflare DNS-only records in place; ${resend}. Sending stays off until the Email product API key and release auth.`
}

/** Ops DNS is not product readiness. Live send stays gated. */
export function outreachSendingUnlocked() {
  return INTENDED_OUTREACH_DOMAINS.some((domain) => domain.sendingReady)
}
