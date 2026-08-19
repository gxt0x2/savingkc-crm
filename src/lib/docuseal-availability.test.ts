import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  DOCUSEAL_UNAVAILABLE_MESSAGE,
  docusealUnavailableResponse,
  isDocusealEnabled,
  isDocusealReady,
} from './docuseal-availability'

describe('DocuSeal availability containment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('defaults off when the server flag is absent', () => {
    expect(isDocusealEnabled(undefined)).toBe(false)
  })

  it('enables only for the explicit server value true', () => {
    expect(isDocusealEnabled('true')).toBe(true)
    expect(isDocusealEnabled('TRUE')).toBe(false)
    expect(isDocusealEnabled('1')).toBe(false)
  })

  it('requires the feature flag, API token, and webhook secret together', () => {
    expect(isDocusealReady({ enabled: 'true', token: 'token', webhookSecret: 'secret' })).toBe(true)
    expect(isDocusealReady({ enabled: 'true', token: '', webhookSecret: 'secret' })).toBe(false)
    expect(isDocusealReady({ enabled: 'true', token: 'token', webhookSecret: '' })).toBe(false)
    expect(isDocusealReady({ enabled: 'false', token: 'token', webhookSecret: 'secret' })).toBe(false)
  })

  it('returns a non-cacheable service-unavailable response', async () => {
    const response = docusealUnavailableResponse()

    expect(response.status).toBe(503)
    expect(response.headers.get('cache-control')).toBe('private, no-store, max-age=0')
    await expect(response.json()).resolves.toEqual({
      error: DOCUSEAL_UNAVAILABLE_MESSAGE,
      code: 'DOCUSEAL_DISABLED',
    })
  })
})
