import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  createServerClient: vi.fn(),
  cookies: vi.fn(),
  resolveTwimlAppSid: vi.fn(),
  accessToken: vi.fn(),
  addGrant: vi.fn(),
  voiceGrant: vi.fn(),
}))

vi.mock('@supabase/ssr', () => ({
  createServerClient: mocks.createServerClient,
}))

vi.mock('next/headers', () => ({
  cookies: mocks.cookies,
}))

vi.mock('@/lib/telephony/twiml-app', () => ({
  cleanTwilioEnv: vi.fn((name: string) => ({
    TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    TWILIO_API_KEY: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    TWILIO_API_SECRET: 'secret',
  } as Record<string, string>)[name] || ''),
  requireTwilioEnv: vi.fn((name: string) => ({
    TWILIO_ACCOUNT_SID: 'ACaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    TWILIO_API_KEY: 'SKbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
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

describe('Twilio browser voice token authorization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.cookies.mockResolvedValue({ getAll: () => [] })
    mocks.createServerClient.mockReturnValue({ auth: { getUser: mocks.getUser } })
    mocks.resolveTwimlAppSid.mockResolvedValue('APcccccccccccccccccccccccccccccccc')
  })

  it('does not let a trusted health bearer mint a token without a CRM user', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body).toEqual({ error: 'Unauthorized' })
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(mocks.resolveTwimlAppSid).not.toHaveBeenCalled()
    expect(mocks.accessToken).not.toHaveBeenCalled()
  })

  it('preserves token minting for an authenticated CRM user', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-ernest', email: 'ernest@savingkc.com' } },
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      token: 'header.payload.signature',
      identity: 'ernest',
      twimlAppSid: 'APcccccccccccccccccccccccccccccccc',
    })
    expect(mocks.accessToken).toHaveBeenCalledTimes(1)
    expect(mocks.addGrant).toHaveBeenCalledTimes(1)
  })
})
