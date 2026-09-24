import { describe, expect, it } from 'vitest'

import {
  crmEmailForConnectedGoogleAccount,
  decodeGoogleOAuthState,
  encodeGoogleOAuthState,
} from '@/lib/google-oauth-state'

describe('Google OAuth state', () => {
  it('round-trips the CRM login that started consent', () => {
    const state = encodeGoogleOAuthState({
      returnTo: '/settings',
      crmEmail: 'OAuth-Review@savingkc.com',
    })
    expect(decodeGoogleOAuthState(state)).toEqual({
      returnTo: '/settings',
      provider: 'google',
      crmEmail: 'oauth-review@savingkc.com',
    })
  })

  it('keeps Google Ads state separate and ignores off-site return paths', () => {
    const state = encodeGoogleOAuthState({
      returnTo: 'https://evil.example',
      provider: 'google_ads',
    })
    expect(decodeGoogleOAuthState(state)).toEqual({
      returnTo: '/settings',
      provider: 'google_ads',
      crmEmail: null,
    })
    expect(decodeGoogleOAuthState(null)).toEqual({
      returnTo: '/settings',
      provider: 'google',
      crmEmail: null,
    })
  })

  it('links the live CRM session, then the state email, and never invents an owner', () => {
    expect(crmEmailForConnectedGoogleAccount({
      sessionEmail: 'oauth-review@savingkc.com',
      stateCrmEmail: 'ernest@savingkc.com',
    })).toBe('oauth-review@savingkc.com')
    expect(crmEmailForConnectedGoogleAccount({
      stateCrmEmail: 'oauth-review@savingkc.com',
    })).toBe('oauth-review@savingkc.com')
    expect(crmEmailForConnectedGoogleAccount({})).toBeNull()
  })
})
