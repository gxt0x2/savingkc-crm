export const DOCUSEAL_UNAVAILABLE_MESSAGE =
  'Assignment signing is temporarily unavailable while DocuSeal is offline.'

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'private, no-store, max-age=0',
}

export function isDocusealEnabled(value: string | undefined): boolean {
  return value === 'true'
}

export function isDocusealReady(config: {
  enabled: string | undefined
  token: string | undefined
  webhookSecret: string | undefined
}): boolean {
  return (
    isDocusealEnabled(config.enabled) &&
    Boolean(config.token?.trim()) &&
    Boolean(config.webhookSecret?.trim())
  )
}

export function docusealUnavailableResponse(): Response {
  return Response.json(
    {
      error: DOCUSEAL_UNAVAILABLE_MESSAGE,
      code: 'DOCUSEAL_DISABLED',
    },
    {
      status: 503,
      headers: NO_STORE_HEADERS,
    },
  )
}

export { NO_STORE_HEADERS as DOCUSEAL_NO_STORE_HEADERS }
