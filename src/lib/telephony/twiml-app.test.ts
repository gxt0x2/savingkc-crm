import { afterEach, describe, expect, it, vi } from 'vitest'

import { resolveTwimlAppSid } from './twiml-app'

describe('resolveTwimlAppSid', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('uses the explicitly configured canonical application without a network request', async () => {
    vi.stubEnv('TWILIO_TWIML_APP_SID', 'APconfigured')
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveTwimlAppSid()).resolves.toBe('APconfigured')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('discovers the existing canonical application when production stores no SID', async () => {
    vi.stubEnv('TWILIO_TWIML_APP_SID', '')
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACaccount')
    vi.stubEnv('TWILIO_API_KEY', 'SKkey')
    vi.stubEnv('TWILIO_API_SECRET', 'secret')
    vi.stubEnv('VERCEL_ENV', 'production')
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ applications: [{ friendly_name: 'SavingKC CRM', sid: 'APexisting' }] }),
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveTwimlAppSid()).resolves.toBe('APexisting')
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does not create shared Twilio infrastructure from a preview deployment', async () => {
    vi.stubEnv('TWILIO_TWIML_APP_SID', '')
    vi.stubEnv('TWILIO_ACCOUNT_SID', 'ACaccount')
    vi.stubEnv('TWILIO_API_KEY', 'SKkey')
    vi.stubEnv('TWILIO_API_SECRET', 'secret')
    vi.stubEnv('VERCEL_ENV', 'preview')
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://preview.example')
    const fetchMock = vi.fn().mockResolvedValue({ json: async () => ({ applications: [] }) })
    vi.stubGlobal('fetch', fetchMock)

    await expect(resolveTwimlAppSid()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/Applications.json'), expect.objectContaining({ headers: expect.any(Object) }))
  })
})
