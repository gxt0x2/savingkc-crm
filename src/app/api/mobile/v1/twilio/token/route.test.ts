import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireMobileUser: vi.fn(),
  resolveTwimlAppSid: vi.fn(),
  accessToken: vi.fn(),
  addGrant: vi.fn(),
  voiceGrant: vi.fn(),
  actor: vi.fn(),
  env: {} as Record<string, string>,
}))

vi.mock('@/lib/mobile-api/authorized-lead', () => ({ resolveMobileScopedActor: mocks.actor }))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mobile-api/auth')>()
  return { ...actual, requireMobileUser: mocks.requireMobileUser }
})

vi.mock('@/lib/telephony/twiml-app', () => ({
  cleanTwilioEnv: vi.fn((name: string) => mocks.env[name] || ''),
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
    mocks.env = {
      TWILIO_ACCOUNT_SID: `AC${'a'.repeat(32)}`,
      TWILIO_API_KEY: `SK${'b'.repeat(32)}`,
      TWILIO_API_SECRET: 'secret',
      TWILIO_VOIP_PUSH_CREDENTIAL_SID: `CR${'d'.repeat(32)}`,
    }
    mocks.requireMobileUser.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com' })
    mocks.resolveTwimlAppSid.mockResolvedValue(`AP${'c'.repeat(32)}`)
  })

  it('does not issue voice credentials to an unregistered authenticated account', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(request() as never)
    expect(response.status).toBe(403)
    expect(mocks.accessToken).not.toHaveBeenCalled()
  })

  it('resolves application integrity before minting the Voice grant', async () => {
    const response = await GET(request() as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      token: 'header.payload.signature',
      identity: 'casey',
      incomingPushConfigured: true,
    })
    expect(mocks.resolveTwimlAppSid.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.voiceGrant.mock.invocationCallOrder[0])
    expect(mocks.accessToken).toHaveBeenCalledTimes(1)
    expect(mocks.voiceGrant).toHaveBeenCalledWith({
      outgoingApplicationSid: `AP${'c'.repeat(32)}`,
      incomingAllow: true,
      pushCredentialSid: `CR${'d'.repeat(32)}`,
    })
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

  it('allows outbound calling without the inbound VoIP push credential', async () => {
    delete mocks.env.TWILIO_VOIP_PUSH_CREDENTIAL_SID

    const response = await GET(request() as never)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ token: 'header.payload.signature', incomingPushConfigured: false })
    expect(mocks.voiceGrant).toHaveBeenCalledWith({
      outgoingApplicationSid: `AP${'c'.repeat(32)}`,
      incomingAllow: true,
    })
  })
})
