import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireMobileUser: vi.fn(),
  resolveTwimlAppSid: vi.fn(),
  accessToken: vi.fn(),
  addGrant: vi.fn(),
  voiceGrant: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mobile-api/auth')>()
  return { ...actual, requireMobileUser: mocks.requireMobileUser }
})

vi.mock('@/lib/telephony/twiml-app', () => ({
  cleanTwilioEnv: vi.fn((name: string) => ({
    TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
    TWILIO_API_KEY: `SK${'b'.repeat(32)}`,
    TWILIO_API_SECRET: 'secret',
  } as Record<string, string>)[name] || ''),
  resolveTwimlAppSid: mocks.resolveTwimlAppSid,
}))

vi.mock('twilio', () => {
  class VoiceGrant {
    constructor(options: unknown) {
      mocks.voiceGrant(options)
    }
  }

  class AccessToken {
    static VoiceGrant = VoiceGrant

    constructor(...args: unknown[]) {
      mocks.accessToken(...args)
    }

    addGrant(grant: unknown) {
      mocks.addGrant(grant)
    }

    toJwt() {
      return 'header.payload.signature'
    }
  }

  return { default: { jwt: { AccessToken } } }
})

import { GET } from './route'

function request() {
  return new Request('https://crm.savingkc.com/api/mobile/v1/twilio/token', {
    headers: { Authorization: 'Bearer mobile-token' },
  })
}

describe('mobile Twilio Voice token application integrity', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileUser.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.resolveTwimlAppSid.mockResolvedValue(`AP${'c'.repeat(32)}`)
  })

  it('resolves application integrity before minting the Voice grant', async () => {
    const response = await GET(request() as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      token: 'header.payload.signature',
      identity: 'casey',
    })
    expect(mocks.resolveTwimlAppSid.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.voiceGrant.mock.invocationCallOrder[0])
    expect(mocks.accessToken).toHaveBeenCalledTimes(1)
  })

  it('fails closed without exposing configuration when validation is unavailable', async () => {
    mocks.resolveTwimlAppSid.mockResolvedValue(undefined)

    const response = await GET(request() as never)
    const body = await response.json()

    expect(response.status).toBe(503)
    expect(body).toEqual({ error: 'Calling is temporarily unavailable' })
    expect(JSON.stringify(body)).not.toContain('TWILIO_')
    expect(JSON.stringify(body)).not.toContain('APcccc')
    expect(mocks.voiceGrant).not.toHaveBeenCalled()
    expect(mocks.accessToken).not.toHaveBeenCalled()
  })
})
