const DEFAULT_CRM_TRACKING_ORIGIN = 'https://crm.savingkc.com'
const PUBLIC_SAVINGKC_HOSTS = new Set(['savingkc.com', 'www.savingkc.com'])
const TRACKING_PATH = '/api/ppc/track'

function configuredEndpoint(value: string | undefined): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null

  try {
    const url = new URL(trimmed)
    const pathname = url.pathname.replace(/\/+$/, '')
    url.pathname = pathname.endsWith(TRACKING_PATH)
      ? pathname
      : `${pathname || ''}${TRACKING_PATH}`
    url.search = ''
    url.hash = ''
    return url.toString()
  } catch {
    return null
  }
}

function crmTrackingOrigin(): string {
  const configuredCrmOrigin = configuredEndpoint(process.env.NEXT_PUBLIC_APP_URL)
  if (configuredCrmOrigin) return configuredCrmOrigin
  return `${DEFAULT_CRM_TRACKING_ORIGIN}${TRACKING_PATH}`
}

export function resolvePpcTrackingEndpoint(pageUrl: string | URL): string {
  const explicitEndpoint =
    configuredEndpoint(process.env.PPC_TRACKING_ENDPOINT_URL) ||
    configuredEndpoint(process.env.PPC_TRACKING_ORIGIN)
  if (explicitEndpoint) return explicitEndpoint

  const url = typeof pageUrl === 'string' ? new URL(pageUrl) : pageUrl
  const hostname = url.hostname.toLowerCase()
  if (PUBLIC_SAVINGKC_HOSTS.has(hostname)) return crmTrackingOrigin()

  return `${url.origin}${TRACKING_PATH}`
}
