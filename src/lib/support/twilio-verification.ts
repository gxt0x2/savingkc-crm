import { cleanTwilioEnv } from '@/lib/telephony/twiml-app'

const TWILIO_ACCOUNT_API_BASE = 'https://api.twilio.com/2010-04-01/Accounts'
const TWILIO_ACCOUNT_API_TIMEOUT_MS = 5_000

export type TwilioCredentialMode = 'auth_token' | 'not_configured'
export type TwilioAccountApiStatus =
  | 'valid'
  | 'invalid_credentials'
  | 'unavailable'
  | 'not_configured'

export interface TwilioVerificationResult {
  ok: boolean
  configuration: {
    accountSidConfigured: boolean
    apiKeySidConfigured: boolean
    apiKeySecretConfigured: boolean
    authTokenConfigured: boolean
    credentialMode: TwilioCredentialMode
  }
  signatureValidation: {
    bypassEnabled: boolean
  }
  accountApi: {
    status: TwilioAccountApiStatus
    credentialsValid: boolean | null
  }
}

type CredentialSelection = {
  accountSid: string
  username: string
  password: string
}

function selectCredentials(values: {
  accountSid: string
  authToken: string
}): CredentialSelection | null {
  if (values.accountSid && values.authToken) {
    return {
      accountSid: values.accountSid,
      username: values.accountSid,
      password: values.authToken,
    }
  }

  return null
}

/**
 * Verify the configured server-side credentials with one read-only Account API
 * request. The provider response body is deliberately never read or returned.
 */
export async function verifyTwilioAccountCredentials(): Promise<TwilioVerificationResult> {
  const values = {
    accountSid: cleanTwilioEnv('TWILIO_ACCOUNT_SID'),
    apiKeySid: cleanTwilioEnv('TWILIO_API_KEY'),
    apiKeySecret: cleanTwilioEnv('TWILIO_API_SECRET'),
    authToken: cleanTwilioEnv('TWILIO_AUTH_TOKEN'),
  }
  // Webhook signatures use TWILIO_AUTH_TOKEN, so an API key is not a valid
  // substitute for this verification even when it can access the REST API.
  const credentials = selectCredentials(values)
  const configuration: TwilioVerificationResult['configuration'] = {
    accountSidConfigured: Boolean(values.accountSid),
    apiKeySidConfigured: Boolean(values.apiKeySid),
    apiKeySecretConfigured: Boolean(values.apiKeySecret),
    authTokenConfigured: Boolean(values.authToken),
    credentialMode: credentials ? 'auth_token' : 'not_configured',
  }
  const signatureValidation = {
    bypassEnabled: process.env.TWILIO_SKIP_SIGNATURE_VALIDATION === 'true',
  }

  if (!credentials) {
    return {
      ok: false,
      configuration,
      signatureValidation,
      accountApi: { status: 'not_configured', credentialsValid: null },
    }
  }

  const authorization = Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')

  try {
    const response = await fetch(
      `${TWILIO_ACCOUNT_API_BASE}/${encodeURIComponent(credentials.accountSid)}.json`,
      {
        method: 'GET',
        headers: { Authorization: `Basic ${authorization}` },
        cache: 'no-store',
        signal: AbortSignal.timeout(TWILIO_ACCOUNT_API_TIMEOUT_MS),
      },
    )
    void response.body?.cancel()

    if (response.ok) {
      const ready = !signatureValidation.bypassEnabled
      return {
        ok: ready,
        configuration,
        signatureValidation,
        accountApi: { status: 'valid', credentialsValid: true },
      }
    }

    if (response.status === 401 || response.status === 403 || response.status === 404) {
      return {
        ok: false,
        configuration,
        signatureValidation,
        accountApi: { status: 'invalid_credentials', credentialsValid: false },
      }
    }

    return {
      ok: false,
      configuration,
      signatureValidation,
      accountApi: { status: 'unavailable', credentialsValid: null },
    }
  } catch {
    return {
      ok: false,
      configuration,
      signatureValidation,
      accountApi: { status: 'unavailable', credentialsValid: null },
    }
  }
}
