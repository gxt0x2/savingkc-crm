import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  validateRequest: vi.fn(),
}))

vi.mock('twilio', () => ({
  default: {
    validateRequest: mocks.validateRequest,
  },
}))

import { validateTwilioRequest, validateTwilioWebhook } from './twilio-validate'

describe('Twilio signature validation containment', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('never honors the bypass flag in a production runtime', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('TWILIO_SKIP_SIGNATURE_VALIDATION', 'true')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'production-auth-token')

    expect(validateTwilioRequest('https://crm.savingkc.com/api/twilio', {}, null)).toBe(false)
    expect(mocks.validateRequest).not.toHaveBeenCalled()
  })

  it('never applies the development shortcut on a production deployment', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('TWILIO_SKIP_SIGNATURE_VALIDATION', 'true')

    const request = new Request('https://crm.savingkc.com/api/twilio', {
      method: 'POST',
      body: new URLSearchParams({ CallSid: 'CA123' }),
    })

    await expect(validateTwilioWebhook(request)).resolves.toBe(false)
  })

  it('still supports explicitly bypassing signatures in local development', () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('VERCEL_ENV', 'development')
    vi.stubEnv('TWILIO_SKIP_SIGNATURE_VALIDATION', 'true')

    expect(validateTwilioRequest('http://localhost:3000/api/twilio', {}, null)).toBe(true)
  })

  it('validates signed production requests with the configured auth token', () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('VERCEL_ENV', 'production')
    vi.stubEnv('TWILIO_SKIP_SIGNATURE_VALIDATION', '')
    vi.stubEnv('TWILIO_AUTH_TOKEN', 'production-auth-token')
    mocks.validateRequest.mockReturnValue(true)

    expect(validateTwilioRequest(
      'https://crm.savingkc.com/api/twilio',
      { CallSid: 'CA123' },
      'signed-request',
    )).toBe(true)
    expect(mocks.validateRequest).toHaveBeenCalledWith(
      'production-auth-token',
      'signed-request',
      'https://crm.savingkc.com/api/twilio',
      { CallSid: 'CA123' },
    )
  })
})
