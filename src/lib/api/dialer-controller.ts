const CONTROLLER_HEADER = 'x-dialer-controller'
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type DialerControllerRequest = {
  token: string
  label: string
}

function browserName(userAgent: string): string {
  if (/edg\//i.test(userAgent)) return 'Edge'
  if (/opr\//i.test(userAgent)) return 'Opera'
  if (/chrome\//i.test(userAgent) || /crios\//i.test(userAgent)) return 'Chrome'
  if (/firefox\//i.test(userAgent) || /fxios\//i.test(userAgent)) return 'Firefox'
  if (/safari\//i.test(userAgent)) return 'Safari'
  return 'Browser'
}

function platformName(request: Request, userAgent: string): string {
  const clientPlatform = request.headers.get('sec-ch-ua-platform')?.replaceAll('"', '').trim()
  if (clientPlatform) return clientPlatform === 'macOS' ? 'Mac' : clientPlatform
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'iOS'
  if (/android/i.test(userAgent)) return 'Android'
  if (/macintosh|mac os x/i.test(userAgent)) return 'Mac'
  if (/windows/i.test(userAgent)) return 'Windows'
  if (/linux/i.test(userAgent)) return 'Linux'
  return 'device'
}

export function dialerControllerFromRequest(request: Request): DialerControllerRequest | null {
  const token = request.headers.get(CONTROLLER_HEADER)?.trim() || ''
  if (!UUID_PATTERN.test(token)) return null
  const userAgent = request.headers.get('user-agent') || ''
  return {
    token,
    label: `${browserName(userAgent)} on ${platformName(request, userAgent)}`.slice(0, 120),
  }
}

export function invalidDialerControllerResponse() {
  return Response.json(
    { error: 'This browser could not identify its dialing controls. Refresh and try again.', code: 'invalid_dialer_controller' },
    { status: 400, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } },
  )
}
