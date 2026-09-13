import { parse } from 'tldts'

/** Accept hostnames only. URLs, addresses, ports and private suffixes are not sender domains. */
export function normalizeEmailDomain(value: string) {
  const domain = value.trim().toLowerCase()
  const labels = domain.split('.')
  if (
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    )
  )
    throw new Error('INVALID_EMAIL_DOMAIN')
  const parsed = parse(domain, { allowPrivateDomains: false })
  if (!parsed.isIcann || !parsed.domain || parsed.isIp)
    throw new Error('INVALID_EMAIL_DOMAIN')
  return domain
}
export function assertIndependentSendingDomain(
  candidate: string,
  primary: string,
) {
  const c = normalizeEmailDomain(candidate),
    p = normalizeEmailDomain(primary)
  if (parse(c).domain === parse(p).domain)
    throw new Error('PRIMARY_DOMAIN_OR_SUBDOMAIN_FORBIDDEN')
  return c
}
export function senderCanStartNewEnrollment(
  state: 'draft' | 'active' | 'paused' | 'retired',
) {
  return state === 'active'
}
export function senderCanReceive(
  state: 'draft' | 'active' | 'paused' | 'retired',
) {
  return state !== 'draft'
}
