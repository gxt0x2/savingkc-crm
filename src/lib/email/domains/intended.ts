/** Primary business domain. Never a campaign sender. */
export const PRIMARY_BUSINESS_DOMAIN = 'savingkc.com'

/**
 * Owner-purchased outreach domains (Cloudflare Registrar, 2026-09-13).
 * Nameservers are on Cloudflare. They are not email-DNS-ready, not in
 * Resend, and not sending-ready. This catalog is copy/fixture data only.
 */
export type IntendedOutreachDomain = {
  name: string
  registrarOwned: true
  nameserversOnCloudflare: true
  cloudflareDnsWritten: false
  resendDomainAdded: false
  emailAuthenticationReady: false
  receivingMxReady: false
  sendingReady: false
}

const NOT_PROVIDER_READY = {
  registrarOwned: true,
  nameserversOnCloudflare: true,
  cloudflareDnsWritten: false,
  resendDomainAdded: false,
  emailAuthenticationReady: false,
  receivingMxReady: false,
  sendingReady: false,
} as const

export const INTENDED_OUTREACH_DOMAINS: readonly IntendedOutreachDomain[] = [
  { name: 'talktosavingkc.com', ...NOT_PROVIDER_READY },
  { name: 'savingkcteam.com', ...NOT_PROVIDER_READY },
  { name: 'yourkchomebuyer.com', ...NOT_PROVIDER_READY },
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
    dnsReady: domain.cloudflareDnsWritten && domain.emailAuthenticationReady,
    resendReady: domain.resendDomainAdded,
    sendingReady: domain.sendingReady,
  }
}
