import {
  ProviderCheckError,
  type EmailValidationProvider,
  type PaidEmailStatus,
  type ProviderVerification,
} from './provider'

/**
 * Opt-in real-time checker. Used only when EMAIL_VALIDATION_PROVIDER=millionverifier.
 * ZeroBounce is the default adapter.
 *
 * The API key is read from MILLIONVERIFIER_API_KEY. When that variable is
 * empty the adapter is not constructed and the address stays unverified.
 * Nothing in this module signs up for an account or spends credit by itself.
 *
 * https://developer.millionverifier.com/
 * https://github.com/hubuco/millionverifier-real-time-api-v3
 */
const ENDPOINT = 'https://api.millionverifier.com/api/v3/'

const RESULT_STATUS: Record<string, PaidEmailStatus> = {
  ok: 'valid',
  catch_all: 'catch_all',
  unknown: 'unknown',
  disposable: 'disposable',
  invalid: 'invalid',
}

function storedRaw(body: Record<string, unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  for (const key of ['email', 'quality', 'result', 'resultcode', 'subresult', 'free', 'role', 'didyoumean', 'credits', 'executiontime', 'error', 'livemode']) {
    if (key in body) raw[key] = body[key]
  }
  return raw
}

export function millionVerifierFromEnv(
  env: NodeJS.ProcessEnv | { MILLIONVERIFIER_API_KEY?: string } = process.env,
  fetcher: typeof fetch = fetch,
): EmailValidationProvider | null {
  const apiKey = (env as { MILLIONVERIFIER_API_KEY?: string }).MILLIONVERIFIER_API_KEY?.trim()
  if (!apiKey) return null
  return createMillionVerifier(apiKey, fetcher)
}

export function createMillionVerifier(apiKey: string, fetcher: typeof fetch): EmailValidationProvider {
  return {
    id: 'millionverifier',
    async verify(email: string): Promise<ProviderVerification> {
      const url = new URL(ENDPOINT)
      url.searchParams.set('api', apiKey)
      url.searchParams.set('email', email)
      url.searchParams.set('timeout', '10')
      let response: Response
      try {
        response = await fetcher(url, {
          method: 'GET',
          redirect: 'error',
          cache: 'no-store',
          signal: AbortSignal.timeout(15_000),
        })
      } catch {
        throw new ProviderCheckError('Email validation provider did not respond')
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => undefined)
        throw new ProviderCheckError('Email validation provider rejected the request', { error: 'provider_http', status: response.status })
      }
      const body = await response.json().catch(() => null) as Record<string, unknown> | null
      if (!body || typeof body.result !== 'string') {
        throw new ProviderCheckError('Email validation provider returned an unreadable result')
      }
      const status = RESULT_STATUS[body.result]
      if (!status || body.result === 'error' || body.resultcode === 4) {
        throw new ProviderCheckError('Email validation provider could not check this address', storedRaw(body))
      }
      return {
        status,
        role: body.role === true,
        raw: storedRaw(body),
      }
    },
  }
}
