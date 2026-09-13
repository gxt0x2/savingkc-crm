import { describe, expect, it } from 'vitest'
import {
  EMAIL_FLAGS_MUST_STAY_OFF,
  EMAIL_HOSTED_SECRETS,
  EMAIL_RESEND_KEY_PATTERN,
  EMAIL_SECRETS_NOT_THIS_PRODUCT,
  emailHostedSecretNames,
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
  it('does not treat hosted secrets as a live-send unlock', () => {
    expect(EMAIL_FLAGS_MUST_STAY_OFF).toEqual([
      'EMAIL_LIVE_DISPATCH_ENABLED',
      'EMAIL_CONTROLLED_PROVIDER_EVIDENCE',
      'EMAIL_AI_ENABLED',
    ])
    expect(emailLiveSendUnlockedByHostedSecrets()).toBe(false)
  })
})
