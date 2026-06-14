import { createHash } from 'node:crypto'

type HeaderSource = {
  headers: Headers
}

export type DealTrackingRequestContext = {
  ipHash: string | null
  userAgentHash: string | null
  isInternal: boolean
  payload: {
    ip_hash: string | null
    user_agent_hash: string | null
    device_platform: string | null
    device_type: 'desktop' | 'mobile' | 'tablet' | 'bot' | 'unknown'
    device_mobile: boolean | null
    accept_language: string | null
    is_internal: boolean
    internal_reasons: string[]
  }
}

function envText(...keys: string[]): string | null {
  for (const key of keys) {
    const value = process.env[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return null
}

function envList(...keys: string[]): string[] {
  const value = envText(...keys)
  if (!value) return []
  return value
    .split(/[\n,]/)
    .map((item) => item.trim())
    .filter(Boolean)
}

function hashSalt(): string {
  return envText(
    'DEAL_TRACKING_SALT',
    'PPC_TRACKING_SALT',
    'CRON_SECRET',
    'ADMIN_API_SECRET',
    'DEPLOY_SECRET',
  ) ?? 'savingkc-deal-tracking-v1'
}

function hashPrivate(value: string): string {
  return createHash('sha256').update(`${hashSalt()}:${value}`).digest('hex')
}

function cleanHeader(value: string | null): string | null {
  if (!value) return null
  const cleaned = value.trim()
  if (!cleaned || cleaned.toLowerCase() === 'unknown') return null
  return cleaned
}

function stripPort(value: string): string {
  if (value.startsWith('[')) return value.replace(/^\[|\](?::\d+)?$/g, '')
  const parts = value.split(':')
  if (parts.length === 2 && /^\d+$/.test(parts[1] ?? '')) return parts[0] ?? value
  return value
}

function normalizeIp(value: string): string {
  const mapped = value.trim().toLowerCase().match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/)
  if (mapped?.[1]) return mapped[1]
  const stripped = stripPort(value)
  const lower = stripped.toLowerCase()
  if (lower.startsWith('::ffff:')) return stripped.slice(7)
  return stripped
}

function firstForwardedIp(value: string | null): string | null {
  const cleaned = cleanHeader(value)
  if (!cleaned) return null
  const first = cleaned.split(',')[0]?.trim()
  return first ? normalizeIp(first) : null
}

function clientIp(headers: Headers): string | null {
  return (
    firstForwardedIp(headers.get('x-forwarded-for')) ||
    firstForwardedIp(headers.get('x-vercel-forwarded-for')) ||
    firstForwardedIp(headers.get('x-real-ip')) ||
    firstForwardedIp(headers.get('cf-connecting-ip'))
  )
}

function ipv4ToInt(value: string): number | null {
  const parts = value.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null
  return ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!
}

function ipMatchesRule(ip: string, rule: string): boolean {
  if (ip === rule) return true
  const [base, rawPrefix] = rule.split('/')
  if (!base || !rawPrefix) return false
  const prefix = Number(rawPrefix)
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return false
  const ipInt = ipv4ToInt(ip)
  const baseInt = ipv4ToInt(base)
  if (ipInt == null || baseInt == null) return false
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return (ipInt & mask) === (baseInt & mask)
}

function hashMatches(hash: string | null, rules: string[]): boolean {
  if (!hash) return false
  return rules.some((rule) => rule.length >= 8 && hash.startsWith(rule.toLowerCase()))
}

function platformFromRequest(userAgent: string | null, clientHintPlatform: string | null): string | null {
  const hint = clientHintPlatform?.replace(/^"|"$/g, '').trim()
  if (hint) return hint
  const ua = (userAgent ?? '').toLowerCase()
  if (!ua) return null
  if (ua.includes('iphone') || ua.includes('ipad') || ua.includes('ios')) return 'iOS'
  if (ua.includes('android')) return 'Android'
  if (ua.includes('mac os') || ua.includes('macintosh')) return 'macOS'
  if (ua.includes('windows')) return 'Windows'
  if (ua.includes('linux')) return 'Linux'
  return 'Unknown'
}

function deviceType(userAgent: string | null, mobileHint: string | null): DealTrackingRequestContext['payload']['device_type'] {
  const ua = (userAgent ?? '').toLowerCase()
  if (/bot|crawler|spider|preview|slurp|mediapartners/.test(ua)) return 'bot'
  if (ua.includes('ipad') || ua.includes('tablet')) return 'tablet'
  if (mobileHint === '?1' || ua.includes('iphone') || ua.includes('android') || ua.includes('mobile')) return 'mobile'
  if (ua) return 'desktop'
  return 'unknown'
}

function isMobile(userAgent: string | null, mobileHint: string | null): boolean | null {
  if (mobileHint === '?1') return true
  if (mobileHint === '?0') return false
  const type = deviceType(userAgent, mobileHint)
  if (type === 'mobile' || type === 'tablet') return true
  if (type === 'desktop') return false
  return null
}

export function getDealTrackingRequestContext(req: HeaderSource): DealTrackingRequestContext {
  const headers = req.headers
  const ip = clientIp(headers)
  const userAgent = cleanHeader(headers.get('user-agent'))
  const ipHash = ip ? hashPrivate(`ip:${ip}`) : null
  const userAgentHash = userAgent ? hashPrivate(`ua:${userAgent}`) : null

  const internalReasons: string[] = []
  const rawIpRules = envList('DEAL_INTERNAL_IPS', 'DISPO_INTERNAL_IPS', 'PPC_INTERNAL_IPS', 'INTERNAL_TRAFFIC_IPS')
  if (ip && rawIpRules.some((rule) => ipMatchesRule(ip, rule))) internalReasons.push('ip_match')

  const ipHashRules = envList(
    'DEAL_INTERNAL_IP_HASHES',
    'DISPO_INTERNAL_IP_HASHES',
    'PPC_INTERNAL_IP_HASHES',
    'INTERNAL_TRAFFIC_IP_HASHES',
  )
  if (hashMatches(ipHash, ipHashRules)) internalReasons.push('ip_hash_match')

  const uaHashRules = envList(
    'DEAL_INTERNAL_UA_HASHES',
    'DISPO_INTERNAL_UA_HASHES',
    'PPC_INTERNAL_UA_HASHES',
    'INTERNAL_TRAFFIC_UA_HASHES',
  )
  if (hashMatches(userAgentHash, uaHashRules)) internalReasons.push('user_agent_hash_match')

  const clientHintPlatform = cleanHeader(headers.get('sec-ch-ua-platform'))
  const mobileHint = cleanHeader(headers.get('sec-ch-ua-mobile'))
  const isInternal = internalReasons.length > 0

  return {
    ipHash,
    userAgentHash,
    isInternal,
    payload: {
      ip_hash: ipHash,
      user_agent_hash: userAgentHash,
      device_platform: platformFromRequest(userAgent, clientHintPlatform),
      device_type: deviceType(userAgent, mobileHint),
      device_mobile: isMobile(userAgent, mobileHint),
      accept_language: cleanHeader(headers.get('accept-language')),
      is_internal: isInternal,
      internal_reasons: internalReasons,
    },
  }
}

export function legacyHashedValue(kind: 'ip' | 'ua', hash: string | null): string | null {
  if (!hash) return null
  return `sha256:${kind}:${hash.slice(0, 32)}`
}

export function isSchemaColumnError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false
  return (
    error.code === '42703' ||
    error.code === 'PGRST204' ||
    /column|schema cache|record .* has no field/i.test(error.message ?? '')
  )
}
