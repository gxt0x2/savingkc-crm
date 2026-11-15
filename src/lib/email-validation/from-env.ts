import { millionVerifierFromEnv } from './millionverifier'
import type { EmailValidationProvider } from './provider'
import { zeroBounceFromEnv } from './zerobounce'

type ProviderEnv = {
  EMAIL_VALIDATION_PROVIDER?: string
  ZEROBOUNCE_API_KEY?: string
  MILLIONVERIFIER_API_KEY?: string
}

/**
 * ZeroBounce unless EMAIL_VALIDATION_PROVIDER=millionverifier.
 * An unrecognized provider name skips the paid call.
 */
export function emailValidationProviderFromEnv(
  env: NodeJS.ProcessEnv | ProviderEnv = process.env,
  fetcher: typeof fetch = fetch,
): EmailValidationProvider | null {
  const choice = (env.EMAIL_VALIDATION_PROVIDER ?? '').trim().toLowerCase()
  if (choice === 'millionverifier') return millionVerifierFromEnv(env, fetcher)
  if (choice === '' || choice === 'zerobounce') return zeroBounceFromEnv(env, fetcher)
  return null
}
