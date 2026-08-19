import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

export type DialerCallIntentKind = 'manual' | 'lead' | 'heir'
export type DialerCallIntentSource =
  | 'web_manual'
  | 'web_click_to_call'
  | 'web_power_dialer'
  | 'web_heir_dialer'
  | 'mobile_manual'
  | 'mobile_lead'

export interface DialerCallIntentClaims {
  version: 1
  identity: string
  to: string
  callerId: string
  kind: DialerCallIntentKind
  source: DialerCallIntentSource
  leadId: string | null
  prospectPhoneId: string | null
  clientAttemptId: string
  issuedAt: number
  expiresAt: number
  nonce: string
}

export type DialerCallIntentVerification =
  | { valid: true; claims: DialerCallIntentClaims }
  | { valid: false; reason: 'missing' | 'malformed' | 'invalid_signature' | 'expired' | 'invalid_claims' }

const INTENT_TTL_SECONDS = 90
const MAX_CLOCK_SKEW_SECONDS = 30

export function getDialerCallIntentSecret(): string {
  const secret = process.env.DIALER_CALL_INTENT_SECRET?.trim() || process.env.TWILIO_AUTH_TOKEN?.trim()
  if (!secret || secret.length < 16) throw new Error('Dialer call intent signing is not configured')
  return secret
}

function signature(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

export function createDialerCallIntent(
  input: {
    identity: string
    to: string
    callerId: string
    kind: DialerCallIntentKind
    source: DialerCallIntentSource
    leadId?: string | null
    prospectPhoneId?: string | null
    clientAttemptId?: string | null
  },
  options: { secret?: string; now?: Date } = {},
): { token: string; claims: DialerCallIntentClaims } {
  const secret = options.secret ?? getDialerCallIntentSecret()
  const to = normalizePhoneToE164(input.to)
  const callerId = normalizePhoneToE164(input.callerId)
  if (!to || !callerId) throw new Error('Dialer call intent phone claims are invalid')

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000)
  const claims: DialerCallIntentClaims = {
    version: 1,
    identity: input.identity.trim().toLowerCase(),
    to,
    callerId,
    kind: input.kind,
    source: input.source,
    leadId: input.leadId?.trim() || null,
    prospectPhoneId: input.prospectPhoneId?.trim() || null,
    clientAttemptId: input.clientAttemptId?.trim() || randomUUID(),
    issuedAt: nowSeconds,
    expiresAt: nowSeconds + INTENT_TTL_SECONDS,
    nonce: randomUUID(),
  }
  if (!isClaims(claims)) throw new Error('Dialer call intent context is invalid')
  const payload = Buffer.from(JSON.stringify(claims), 'utf8').toString('base64url')
  return { token: `${payload}.${signature(payload, secret)}`, claims }
}

function isClaims(value: unknown): value is DialerCallIntentClaims {
  if (!value || typeof value !== 'object') return false
  const claims = value as Partial<DialerCallIntentClaims>
  if (claims.version !== 1) return false
  if (!claims.identity || typeof claims.identity !== 'string') return false
  if (!normalizePhoneToE164(claims.to) || !normalizePhoneToE164(claims.callerId)) return false
  if (!['manual', 'lead', 'heir'].includes(String(claims.kind))) return false
  if (![
    'web_manual',
    'web_click_to_call',
    'web_power_dialer',
    'web_heir_dialer',
    'mobile_manual',
    'mobile_lead',
  ].includes(String(claims.source))) return false
  const sourceMatchesKind = (
    (claims.kind === 'manual' && ['web_manual', 'mobile_manual'].includes(String(claims.source)))
    || (claims.kind === 'lead' && ['web_click_to_call', 'web_power_dialer', 'mobile_lead'].includes(String(claims.source)))
    || (claims.kind === 'heir' && claims.source === 'web_heir_dialer')
  )
  if (!sourceMatchesKind) return false
  if (typeof claims.clientAttemptId !== 'string' || !claims.clientAttemptId) return false
  if (typeof claims.nonce !== 'string' || !claims.nonce) return false
  if (!Number.isInteger(claims.issuedAt) || !Number.isInteger(claims.expiresAt)) return false
  if (claims.kind === 'manual' && (claims.leadId || claims.prospectPhoneId)) return false
  if (claims.kind === 'lead' && (!claims.leadId || claims.prospectPhoneId)) return false
  if (claims.kind === 'heir' && (!claims.leadId || !claims.prospectPhoneId)) return false
  return true
}

export function verifyDialerCallIntent(
  token: string | null | undefined,
  options: { secret?: string; now?: Date } = {},
): DialerCallIntentVerification {
  if (!token) return { valid: false, reason: 'missing' }
  if (token.length > 4096) return { valid: false, reason: 'malformed' }

  const [payload, suppliedSignature, extra] = token.split('.')
  if (!payload || !suppliedSignature || extra) return { valid: false, reason: 'malformed' }

  let secret: string
  try {
    secret = options.secret ?? getDialerCallIntentSecret()
  } catch {
    return { valid: false, reason: 'invalid_signature' }
  }

  const expectedSignature = signature(payload, secret)
  const suppliedBytes = Buffer.from(suppliedSignature)
  const expectedBytes = Buffer.from(expectedSignature)
  if (suppliedBytes.length !== expectedBytes.length || !timingSafeEqual(suppliedBytes, expectedBytes)) {
    return { valid: false, reason: 'invalid_signature' }
  }

  let claims: unknown
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return { valid: false, reason: 'malformed' }
  }
  if (!isClaims(claims)) return { valid: false, reason: 'invalid_claims' }

  const nowSeconds = Math.floor((options.now ?? new Date()).getTime() / 1000)
  if (
    claims.issuedAt > nowSeconds + MAX_CLOCK_SKEW_SECONDS
    || claims.expiresAt <= nowSeconds
    || claims.expiresAt - claims.issuedAt > INTENT_TTL_SECONDS
  ) {
    return { valid: false, reason: 'expired' }
  }

  return { valid: true, claims }
}
