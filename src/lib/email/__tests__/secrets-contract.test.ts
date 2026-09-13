import { describe, expect, it } from 'vitest'
import {
  EMAIL_CONNECTIONS_SECRET_CONTRACT,
  EMAIL_FLAGS_MUST_STAY_OFF,
  EMAIL_HOSTED_SECRETS,
  EMAIL_PREFERENCE_KEY_FAMILY,
  EMAIL_RESEND_KEY_PATTERN,
  EMAIL_RESEND_PRODUCT_KEY_LABEL,
  EMAIL_RESEND_WEBHOOK_AFTER_RELEASE_URL,
  EMAIL_RESEND_WEBHOOK_PATH,
  EMAIL_RESEND_WEBHOOK_SECRET_PATTERN,
  EMAIL_HOSTED_DEPLOY_SNAPSHOT,
  EMAIL_HOSTED_SECRET_PRESENCE,
  EMAIL_SECRETS_NOT_THIS_PRODUCT,
  emailHostedSecretNames,
  emailHostedSecretsAreLive,
  emailLiveSendUnlockedByHostedSecrets,
} from '../secrets-contract'

describe('Email hosted secret contract', () => {
  it('names the Connections encryption key and rejects the Conversations env', () => {
    expect(emailHostedSecretNames()).toContain('EMAIL_CREDENTIALS_KEY_V1')
    expect(EMAIL_SECRETS_NOT_THIS_PRODUCT).toContain('RESEND_API_KEY')
    expect(new RegExp(EMAIL_RESEND_KEY_PATTERN).test('re_fixture_key_ok')).toBe(
      true,
    )
    expect(new RegExp(EMAIL_RESEND_KEY_PATTERN).test('sk-live-not-resend')).toBe(
      false,
    )
    expect(
      EMAIL_HOSTED_SECRETS.find((row) => row.name === 'EMAIL_CREDENTIALS_KEY_V1')
        ?.requiredNow,
    ).toBe(true)
  })
  it('documents Connections intake, preference family and webhook path', () => {
    expect(EMAIL_RESEND_PRODUCT_KEY_LABEL).toBe('SavingKC Email CRM')
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.resendApiKey.intake).toMatch(
      /POST \/api\/email\/connections/,
    )
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.credentialsKey).toBe(
      'EMAIL_CREDENTIALS_KEY_V1',
    )
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.preferenceKeyFamily).toBe(
      EMAIL_PREFERENCE_KEY_FAMILY,
    )
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.webhookEndpointId).toBe(
      'EMAIL_RESEND_WEBHOOK_ENDPOINT_ID',
    )
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.webhook).toMatchObject({
      method: 'POST',
      path: EMAIL_RESEND_WEBHOOK_PATH,
      secretCreated: false,
      releaseGated: true,
    })
    expect(EMAIL_RESEND_WEBHOOK_PATH).toBe('/api/webhooks/email/resend')
    expect(
      new RegExp(EMAIL_RESEND_WEBHOOK_SECRET_PATTERN).test(
        'whsec_fixture_secret_ok',
      ),
    ).toBe(true)
    expect(
      EMAIL_CONNECTIONS_SECRET_CONTRACT.webhook.publicUrlTemplate,
    ).toBe('https://<host>/api/webhooks/email/resend')
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.webhook.afterReleaseUrl).toBe(
      EMAIL_RESEND_WEBHOOK_AFTER_RELEASE_URL,
    )
    expect(EMAIL_RESEND_WEBHOOK_AFTER_RELEASE_URL).toBe(
      'https://crm.savingkc.com/api/webhooks/email/resend',
    )
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.resendApiKey.existsOffChat).toBe(
      true,
    )
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.resendApiKey.liveSendUnlocked).toBe(
      false,
    )
    expect(EMAIL_CONNECTIONS_SECRET_CONTRACT.hostedPresence).toBe(
      'present-not-live',
    )
  })
  it('records hosted env names as present-but-not-live', () => {
    expect(EMAIL_HOSTED_SECRET_PRESENCE.EMAIL_CREDENTIALS_KEY_V1).toMatchObject({
      presence: 'present-not-live',
      project: 'savingkc-crm',
      environments: ['production', 'preview'],
      servingEmailRoutes: false,
    })
    expect(EMAIL_HOSTED_SECRET_PRESENCE.RESEND_API_KEY).toMatchObject({
      presence: 'present-not-live',
      product: 'conversations',
      environments: ['production', 'preview', 'development'],
      servingEmail: false,
    })
    expect(emailHostedSecretsAreLive()).toBe(false)
    expect(EMAIL_HOSTED_DEPLOY_SNAPSHOT).toMatchObject({
      productionHost: 'crm.savingkc.com',
      deploymentId: 'EtBjRSLjZBgodpWYcsddzqZVCS8e',
      state: 'Ready',
      envSecretsApply: true,
      emailFoundationRoutesLive: false,
    })
  })
  it('does not treat hosted secrets as a live-send unlock', () => {
    expect(EMAIL_FLAGS_MUST_STAY_OFF).toEqual([
      'EMAIL_LIVE_DISPATCH_ENABLED',
      'EMAIL_CONTROLLED_PROVIDER_EVIDENCE',
      'EMAIL_AI_ENABLED',
    ])
    expect(emailLiveSendUnlockedByHostedSecrets()).toBe(false)
  })
})
