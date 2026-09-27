import { createPublicKey, createVerify, timingSafeEqual } from 'node:crypto'

export const GMAIL_PUBSUB_PUSH_PATH = '/api/webhooks/google/gmail'
export const GMAIL_SANDBOX_MAILBOX = 'savingkc@gmail.com'
const PUSH_SECRET_MIN_LENGTH = 16
const OIDC_CLOCK_SKEW_SECONDS = 30

const TOPIC_PATTERN = /^projects\/[^/\s]+\/topics\/[^/\s]+$/
const SUBSCRIPTION_PATTERN = /^projects\/[^/\s]+\/subscriptions\/[^/\s]+$/

export type GmailPubSubReadiness =
  | {
      ok: true
      topic: string
      subscription: string
      audience: string | null
      serviceAccount: string | null
      pushSecret: string | null
      allowlist: string[]
    }
  | { ok: false; missing: string[] }

type Env = Record<string, string | undefined>

function trimmed(env: Env, name: string): string {
  return env[name]?.trim() || ''
}

export function parseMailboxAllowlist(value: string | undefined): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.includes('@'))
}

export function readGmailPubSubReadiness(env: Env = process.env): GmailPubSubReadiness {
  const missing: string[] = []
  const topic = trimmed(env, 'GOOGLE_PUBSUB_TOPIC')
  const subscription = trimmed(env, 'GOOGLE_PUBSUB_SUBSCRIPTION')
  const audience = trimmed(env, 'GOOGLE_PUBSUB_PUSH_AUDIENCE')
  const serviceAccount = trimmed(env, 'GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT').toLowerCase()
  const pushSecret = trimmed(env, 'GOOGLE_PUBSUB_PUSH_SECRET')

  if (!TOPIC_PATTERN.test(topic)) missing.push('GOOGLE_PUBSUB_TOPIC')
  if (!SUBSCRIPTION_PATTERN.test(subscription)) missing.push('GOOGLE_PUBSUB_SUBSCRIPTION')

  const oidcReady = Boolean(audience && serviceAccount)
  const secretReady = pushSecret.length >= PUSH_SECRET_MIN_LENGTH
  if (!oidcReady && !secretReady) {
    if (audience || serviceAccount) {
      if (!audience) missing.push('GOOGLE_PUBSUB_PUSH_AUDIENCE')
      if (!serviceAccount) missing.push('GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT')
    } else {
      missing.push('GOOGLE_PUBSUB_PUSH_SECRET')
    }
  } else if ((audience && !serviceAccount) || (!audience && serviceAccount)) {
    if (!audience) missing.push('GOOGLE_PUBSUB_PUSH_AUDIENCE')
    if (!serviceAccount) missing.push('GOOGLE_PUBSUB_PUSH_SERVICE_ACCOUNT')
  }
  if (pushSecret && !secretReady && !missing.includes('GOOGLE_PUBSUB_PUSH_SECRET')) {
    missing.push('GOOGLE_PUBSUB_PUSH_SECRET')
  }

  if (missing.length > 0) return { ok: false, missing }
  return {
    ok: true,
    topic,
    subscription,
    audience: audience || null,
    serviceAccount: serviceAccount || null,
    pushSecret: secretReady ? pushSecret : null,
    allowlist: parseMailboxAllowlist(env.GMAIL_WATCH_MAILBOX_ALLOWLIST),
  }
}

function normalizeMailbox(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase()
}

/** Push ingest is limited to staff Google accounts and the OAuth sandbox mailbox. */
export function isStaffOrSandboxMailbox(input: {
  googleEmail: string
  crmEmail?: string | null
  extraAllowlist?: string[]
}): boolean {
  const google = normalizeMailbox(input.googleEmail)
  const crm = normalizeMailbox(input.crmEmail)
  if (!google) return false
  const allowed = new Set([
    GMAIL_SANDBOX_MAILBOX,
    ...(input.extraAllowlist || []).map((entry) => entry.trim().toLowerCase()),
  ])
  if (allowed.has(google) || (crm && allowed.has(crm))) return true
  if (google.endsWith('@savingkc.com') || crm.endsWith('@savingkc.com')) return true
  return false
}

export type GmailPushNote = {
  messageId: string
  emailAddress: string
  historyId: string
  subscription: string | null
}

export function decodeGmailPushMessage(body: unknown): GmailPushNote | null {
  if (!body || typeof body !== 'object') return null
  const message = (body as { message?: unknown }).message
  if (!message || typeof message !== 'object') return null
  const record = message as { data?: unknown; messageId?: unknown }
  const messageId = typeof record.messageId === 'string' ? record.messageId.trim() : ''
  const data = typeof record.data === 'string' ? record.data.trim() : ''
  if (!messageId || !data) return null

  let decoded: unknown
  try {
    const normalized = data.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
  } catch {
    return null
  }
  if (!decoded || typeof decoded !== 'object') return null
  const emailAddress = normalizeMailbox((decoded as { emailAddress?: unknown }).emailAddress as string | undefined)
  const historyId = String((decoded as { historyId?: unknown }).historyId ?? '').trim()
  if (!emailAddress.includes('@') || !/^\d+$/.test(historyId)) return null
  const subscription = (body as { subscription?: unknown }).subscription
  return {
    messageId,
    emailAddress,
    historyId,
    subscription: typeof subscription === 'string' ? subscription : null,
  }
}

function secretsMatch(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied)
  const right = Buffer.from(expected)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

function bearerToken(authorization: string | null): string {
  const match = authorization?.match(/^Bearer\s+(\S+)\s*$/i)
  return match?.[1]?.trim() || ''
}

function looksLikeJwt(value: string): boolean {
  return value.split('.').length === 3
}

type OidcConfig = { audience: string; serviceAccount: string }

export type PubSubAuthResult =
  | { ok: true; method: 'oidc' | 'shared_secret' }
  | { ok: false; status: 401 | 503; reason: string }

export async function authorizeGmailPubSubRequest(input: {
  authorization: string | null
  queryToken: string | null
  headerToken: string | null
  env?: Env
  nowSeconds?: number
  verifyOidc?: (jwt: string, config: OidcConfig) => Promise<boolean>
}): Promise<PubSubAuthResult> {
  const readiness = readGmailPubSubReadiness(input.env)
  if (!readiness.ok) return { ok: false, status: 503, reason: 'pubsub_not_configured' }

  const bearer = bearerToken(input.authorization)
  const secret = readiness.pushSecret
  const presentedSecret = [input.queryToken?.trim() || '', input.headerToken?.trim() || '', bearer && !looksLikeJwt(bearer) ? bearer : '']
  if (secret && presentedSecret.some((value) => value && secretsMatch(value, secret))) {
    return { ok: true, method: 'shared_secret' }
  }
  if (secret && bearer && secretsMatch(bearer, secret)) {
    return { ok: true, method: 'shared_secret' }
  }

  if (readiness.audience && readiness.serviceAccount && bearer && looksLikeJwt(bearer)) {
    const verify = input.verifyOidc || ((jwt, config) => verifyGooglePubSubOidcJwt(jwt, {
      ...config,
      nowSeconds: input.nowSeconds,
    }))
    const valid = await verify(bearer, {
      audience: readiness.audience,
      serviceAccount: readiness.serviceAccount,
    }).catch(() => false)
    if (valid) return { ok: true, method: 'oidc' }
  }

  return { ok: false, status: 401, reason: 'pubsub_auth_rejected' }
}

type Jwk = JsonWebKey & { kid?: string }

let certCache: { keys: Jwk[]; expiresAt: number } | null = null

export function clearGoogleOidcCertCache(): void {
  certCache = null
}

export async function fetchGoogleOidcCerts(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Jwk[]> {
  if (certCache && certCache.expiresAt > now) return certCache.keys
  const res = await fetchImpl('https://www.googleapis.com/oauth2/v3/certs')
  if (!res.ok) throw new Error('google_certs_unavailable')
  const body = await res.json() as { keys?: Jwk[] }
  const keys = Array.isArray(body.keys) ? body.keys : []
  certCache = { keys, expiresAt: now + 60 * 60 * 1000 }
  return keys
}

function decodeJsonPart(part: string): unknown {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

export async function verifyGooglePubSubOidcJwt(
  jwt: string,
  config: OidcConfig & { nowSeconds?: number },
  getCerts: () => Promise<Jwk[]> = () => fetchGoogleOidcCerts(),
): Promise<boolean> {
  const parts = jwt.split('.')
  if (parts.length !== 3) return false
  const [encodedHeader, encodedPayload, encodedSignature] = parts
  let header: { alg?: unknown; kid?: unknown }
  let payload: {
    iss?: unknown
    aud?: unknown
    exp?: unknown
    iat?: unknown
    email?: unknown
    email_verified?: unknown
  }
  try {
    header = decodeJsonPart(encodedHeader) as typeof header
    payload = decodeJsonPart(encodedPayload) as typeof payload
  } catch {
    return false
  }
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') return false
  const issuer = payload.iss
  if (issuer !== 'https://accounts.google.com' && issuer !== 'accounts.google.com') return false
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud]
  if (!audiences.includes(config.audience)) return false
  const now = config.nowSeconds ?? Math.floor(Date.now() / 1000)
  if (typeof payload.exp !== 'number' || payload.exp + OIDC_CLOCK_SKEW_SECONDS < now) return false
  if (typeof payload.iat === 'number' && payload.iat > now + OIDC_CLOCK_SKEW_SECONDS) return false
  if (payload.email_verified !== true) return false
  if (typeof payload.email !== 'string' || payload.email.toLowerCase() !== config.serviceAccount.toLowerCase()) return false

  const certs = await getCerts()
  const jwk = certs.find((key) => key.kid === header.kid)
  if (!jwk) return false
  const key = createPublicKey({
    key: jwk,
    format: 'jwk',
  } as unknown as Parameters<typeof createPublicKey>[0])
  const verifier = createVerify('RSA-SHA256')
  verifier.update(`${encodedHeader}.${encodedPayload}`)
  verifier.end()
  return verifier.verify(key, Buffer.from(encodedSignature, 'base64url'))
}
