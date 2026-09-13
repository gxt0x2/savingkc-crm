/**
 * Hosted-secret contract for SavingKC Email (EM-007 / 03 §2).
 * Names and formats only. No values. Client-safe.
 *
 * Email does not read `RESEND_API_KEY`. That env is Conversations/TC/broadcasts.
 * The Email product stores an owner-pasted `re_…` key encrypted under
 * `EMAIL_CREDENTIALS_KEY_V*`. Live send stays gated even if these secrets exist.
 */
export const EMAIL_RESEND_KEY_PATTERN = '^re_[A-Za-z0-9_-]{12,200}$'

export const EMAIL_HOSTED_SECRETS = [
  {
    name: 'EMAIL_CREDENTIALS_KEY_V1',
    format: '64 hex characters',
    requiredFor: 'Encrypt owner-pasted Resend keys (AES-256-GCM). Never NEXT_PUBLIC_.',
    requiredNow: true,
  },
  {
    name: 'EMAIL_CREDENTIALS_KEY_V2',
    format: '64 hex characters',
    requiredFor: 'Optional rotation. Older V1 must remain until every stored secret is rewritten.',
    requiredNow: false,
  },
  {
    name: 'EMAIL_PREFERENCE_KEY_V1',
    format: '64 hex characters',
    requiredFor: 'HMAC for public unsubscribe tokens / List-Unsubscribe.',
    requiredNow: false,
  },
  {
    name: 'EMAIL_PUBLIC_ORIGIN',
    format: 'https origin, no trailing slash',
    requiredFor: 'Absolute unsubscribe URLs on simulated or future outbound mail.',
    requiredNow: false,
  },
  {
    name: 'EMAIL_RESEND_WEBHOOK_ENDPOINT_ID',
    format: 'UUID of an em_webhook_endpoints row',
    requiredFor: 'Binds POST /api/webhooks/email/resend. Endpoints stay inactive until provisioned.',
    requiredNow: false,
  },
] as const

export const EMAIL_FLAGS_MUST_STAY_OFF = [
  'EMAIL_LIVE_DISPATCH_ENABLED',
  'EMAIL_CONTROLLED_PROVIDER_EVIDENCE',
  'EMAIL_AI_ENABLED',
] as const

export const EMAIL_SECRETS_NOT_THIS_PRODUCT = ['RESEND_API_KEY'] as const

export function emailHostedSecretNames() {
  return EMAIL_HOSTED_SECRETS.map((row) => row.name)
}

export function emailLiveSendUnlockedByHostedSecrets() {
  return false
}
