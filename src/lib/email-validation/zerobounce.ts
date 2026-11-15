import {
  ProviderCheckError,
  type EmailValidationProvider,
  type ProviderVerification,
} from './provider'

/**
 * Default real-time checker. MillionVerifier runs only when
 * EMAIL_VALIDATION_PROVIDER=millionverifier.
 *
 * The API key is read from ZEROBOUNCE_API_KEY. When that variable is empty
 * the adapter is not constructed and the address stays unverified.
 * Nothing in this module signs up for an account or spends credit by itself.
 *
 * Saving KC verification rules: valid with no adverse sub_status stays valid.
 * invalid, spamtrap, abuse, and do_not_mail are hard blocks. catch-all,
 * unknown, and an adverse or unsupported sub_status need review. role_based,
 * disposable, possible_trap, and the catch-all flag stay excluded even when
 * the top-level status is valid. did_you_mean is stored and never applied.
 *
 * The request is a server POST form body with the key and email only.
 * https://www.zerobounce.net/docs/email-validation-api-quickstart/v2-validate-emails
 */
const ENDPOINT = 'https://api.zerobounce.net/v2/validate'

/** Above ZeroBounce's 30s default so the provider can answer before the client aborts. */
const REQUEST_TIMEOUT_MS = 35_000

const RECOGNIZED_STATUS = new Set([
  'valid',
  'invalid',
  'catch-all',
  'unknown',
  'spamtrap',
  'abuse',
  'do_not_mail',
])

const HARD_BLOCK_STATUS = new Set(['invalid', 'spamtrap', 'abuse', 'do_not_mail'])

/** Sub-statuses ZeroBounce documents as safe to email on a valid result. */
const SAFE_VALID_SUBSTATUS = new Set([
  '',
  'alias_address',
  'leading_period_removed',
  'alternate',
  'gold',
  'accept_all',
  'ai_agent_mailbox',
])

const ROLE_SUBSTATUS = new Set(['role_based', 'role_based_catch_all', 'role_based_accept_all'])

const CATCH_ALL_SUBSTATUS = new Set(['role_based_catch_all', 'role_based_accept_all'])

const STORED_FIELDS = [
  'address',
  'status',
  'sub_status',
  'did_you_mean',
  'account',
  'domain',
  'domain_age_days',
  'free_email',
  'mx_found',
  'mx_record',
  'smtp_provider',
  'catchall_domain',
  'processed_at',
] as const

function storedRaw(body: Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  for (const key of STORED_FIELDS) {
    if (key in body) raw[key] = body[key]
  }
  return raw
}

function subStatus(body: Record<string, unknown>): string {
  const value = body.sub_status
  if (value == null || value === '') return ''
  if (typeof value !== 'string') return 'unsupported'
  return value.trim().toLowerCase()
}

function catchAllFlag(value: unknown): boolean {
  if (value === true) return true
  return typeof value === 'string' && value.trim().toLowerCase() === 'true'
}

/** Map one ZeroBounce validate payload. Does not change the address that was checked. */
export function mapZeroBounceResult(body: Record<string, unknown>): ProviderVerification {
  const status = typeof body.status === 'string' ? body.status.trim().toLowerCase() : ''
  if (!RECOGNIZED_STATUS.has(status)) {
    throw new ProviderCheckError('Email validation provider could not check this address')
  }
  const sub = subStatus(body)
  const role = ROLE_SUBSTATUS.has(sub)
  const raw = storedRaw(body)
  if (HARD_BLOCK_STATUS.has(status)) return { status: 'invalid', role, raw }
  if (sub === 'disposable') return { status: 'disposable', role, raw }
  if (status === 'catch-all') return { status: 'catch_all', role, raw }
  if (status === 'unknown') return { status: 'unknown', role, raw }
  const catchAll = catchAllFlag(body.catchall_domain) || CATCH_ALL_SUBSTATUS.has(sub)
  if (sub === 'possible_trap' || role || catchAll || !SAFE_VALID_SUBSTATUS.has(sub)) {
    return { status: catchAll ? 'catch_all' : 'unknown', role, raw }
  }
  return { status: 'valid', role, raw }
}

export function zeroBounceFromEnv(
  env: NodeJS.ProcessEnv | { ZEROBOUNCE_API_KEY?: string } = process.env,
  fetcher: typeof fetch = fetch,
): EmailValidationProvider | null {
  const apiKey = (env as { ZEROBOUNCE_API_KEY?: string }).ZEROBOUNCE_API_KEY?.trim()
  if (!apiKey) return null
  return createZeroBounce(apiKey, fetcher)
}

export function createZeroBounce(apiKey: string, fetcher: typeof fetch): EmailValidationProvider {
  return {
    id: 'zerobounce',
    async verify(email: string): Promise<ProviderVerification> {
      const form = new URLSearchParams()
      form.set('api_key', apiKey)
      form.set('email', email)
      let response: Response
      try {
        response = await fetcher(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: form.toString(),
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
      } catch {
        throw new ProviderCheckError('Email validation provider did not respond')
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ProviderCheckError('Email validation provider rejected the request', { error: 'provider_http', status: response.status })
      }
      const body = await response.json().catch(() => null) as Record<string, unknown> | null
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw new ProviderCheckError('Email validation provider returned an unreadable result')
      }
      return mapZeroBounceResult(body)
    },
  }
}
