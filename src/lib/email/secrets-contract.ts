/**
 * Hosted-secret contract for SavingKC Email (EM-007 / 03 §2).
 * Names and formats only. No values. Client-safe.
 *
 * Email does not read `RESEND_API_KEY`. That env is Conversations/TC/broadcasts.
 * The Email product stores an owner-pasted `re_…` key encrypted under
 * `EMAIL_CREDENTIALS_KEY_V*`. Live send stays gated even if these secrets exist.
 *
 * Named Resend key "SavingKC Email CRM" exists off-chat. Robin is wiring it
 * into product/hosted secrets. That is not a live Email connection and does
 * not unlock send. The webhook signing secret is not created until hosted
 * Email routes deploy under release auth.
 */
export const EMAIL_RESEND_PRODUCT_KEY_LABEL = 'SavingKC Email CRM'
export const EMAIL_RESEND_KEY_PATTERN = '^re_[A-Za-z0-9_-]{12,200}$'
export const EMAIL_RESEND_WEBHOOK_SECRET_PATTERN =
  '^whsec_[A-Za-z0-9+/=_-]{16,200}$'
export const EMAIL_RESEND_WEBHOOK_METHOD = 'POST'
export const EMAIL_RESEND_WEBHOOK_PATH = '/api/webhooks/email/resend'
export const EMAIL_RESEND_WEBHOOK_PUBLIC_URL_TEMPLATE =
  `https://<host>${EMAIL_RESEND_WEBHOOK_PATH}`
export const EMAIL_CONNECTIONS_INTAKE =
  'Connections UI (SVC-CONNECT / POST /api/email/connections)'
export const EMAIL_PREFERENCE_KEY_FAMILY = 'EMAIL_PREFERENCE_KEY_V*'

export const EMAIL_HOSTED_SECRETS = [
  {
    name: 'EMAIL_CREDENTIALS_KEY_V1',
    format: '64 hex characters',
    requiredFor:
      'Encrypt owner-pasted Resend keys (AES-256-GCM). Never NEXT_PUBLIC_.',
    requiredNow: true,
  },
  {
    name: 'EMAIL_CREDENTIALS_KEY_V2',
    format: '64 hex characters',
    requiredFor:
      'Optional rotation. Older V1 must remain until every stored secret is rewritten.',
    requiredNow: false,
  },
  {
    name: 'EMAIL_PREFERENCE_KEY_V1',
    format: '64 hex characters',
    requiredFor:
      'HMAC for public unsubscribe tokens / List-Unsubscribe. Optional V2+ same format (EMAIL_PREFERENCE_KEY_V*).',
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
    requiredFor:
      'Binds POST /api/webhooks/email/resend. Endpoints stay inactive until provisioned. Webhook secret is not created yet.',
    requiredNow: false,
  },
] as const

export const EMAIL_CONNECTIONS_SECRET_CONTRACT = {
  resendApiKey: {
    label: EMAIL_RESEND_PRODUCT_KEY_LABEL,
    intake: EMAIL_CONNECTIONS_INTAKE,
    format: EMAIL_RESEND_KEY_PATTERN,
    existsOffChat: true,
    liveSendUnlocked: false,
  },
  credentialsKey: 'EMAIL_CREDENTIALS_KEY_V1',
  preferenceKeyFamily: EMAIL_PREFERENCE_KEY_FAMILY,
  webhookEndpointId: 'EMAIL_RESEND_WEBHOOK_ENDPOINT_ID',
  webhook: {
    method: EMAIL_RESEND_WEBHOOK_METHOD,
    path: EMAIL_RESEND_WEBHOOK_PATH,
    publicUrlTemplate: EMAIL_RESEND_WEBHOOK_PUBLIC_URL_TEMPLATE,
    secretCreated: false,
    secretFormat: EMAIL_RESEND_WEBHOOK_SECRET_PATTERN,
    releaseGated: true,
  },
} as const

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
