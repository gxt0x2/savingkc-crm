import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { CALENDAR_SCOPE, GMAIL_SEND_SCOPE } from '@/lib/google-oauth-scopes'

const mocks = vi.hoisted(() => ({
  requireMobileUser: vi.fn(),
  token: vi.fn(),
  configured: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/mobile-api/auth')>()
  return { ...actual, requireMobileUser: mocks.requireMobileUser }
})

vi.mock('@/lib/gmail-send', () => ({ loadActorGoogleOAuthToken: mocks.token }))
vi.mock('@/lib/gmail-sync', () => ({ hasGoogleOAuthConfig: mocks.configured }))

import { GET } from './route'
import { MobileAuthError } from '@/lib/mobile-api/auth'

const ACTOR_EMAIL = 'ernest@savingkc.com'

function request() {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/session', {
    headers: { Authorization: 'Bearer mobile-token' },
  })
}

function sessionShape(input: { googleCalendar: boolean; gmail: boolean }) {
  return {
    user: { id: 'actor-1', email: ACTOR_EMAIL },
    capabilities: {
      leadList: true,
      leadDetail: true,
      contacts: true,
      conversations: true,
      sms: true,
      email: true,
      outboundDeviceDialer: false,
      callDisposition: true,
      twilioNativeVoice: true,
      workQueue: true,
      ownerAssignment: true,
      handoffAcceptance: true,
      aiAssistantReadOnly: true,
      calendar: true,
      googleCalendar: input.googleCalendar,
      gmail: input.gmail,
    },
    messaging: {
      email: input.gmail
        ? { provider: 'gmail', configured: true, allowed: true, blastAllowed: false }
        : { provider: 'none', configured: false, allowed: false, blastAllowed: false },
    },
  }
}

describe('mobile session Google capabilities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileUser.mockResolvedValue({ user: { id: 'actor-1', email: ACTOR_EMAIL } })
    mocks.configured.mockReturnValue(true)
  })

  it('reports calendar and gmail.send for the signed-in actor grant', async () => {
    mocks.token.mockResolvedValue({
      user_email: ACTOR_EMAIL,
      scope: `${CALENDAR_SCOPE} ${GMAIL_SEND_SCOPE}`,
    })

    const response = await GET(request())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual(sessionShape({ googleCalendar: true, gmail: true }))
    expect(mocks.token).toHaveBeenCalledWith(ACTOR_EMAIL)
    expect(JSON.stringify(body)).not.toContain('resend')
  })

  it('fail-closes both grants when the actor has no Google token', async () => {
    mocks.token.mockResolvedValue(null)

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(sessionShape({ googleCalendar: false, gmail: false }))
  })

  it('does not treat a calendar-only grant as Gmail send', async () => {
    mocks.token.mockResolvedValue({ user_email: ACTOR_EMAIL, scope: CALENDAR_SCOPE })

    expect(await (await GET(request())).json()).toEqual(sessionShape({ googleCalendar: true, gmail: false }))
  })

  it('does not treat gmail.send without calendar as a calendar grant', async () => {
    mocks.token.mockResolvedValue({ user_email: ACTOR_EMAIL, scope: GMAIL_SEND_SCOPE })

    expect(await (await GET(request())).json()).toEqual(sessionShape({ googleCalendar: false, gmail: true }))
  })

  it('fail-closes when Google OAuth is not configured', async () => {
    mocks.configured.mockReturnValue(false)
    mocks.token.mockResolvedValue({
      user_email: ACTOR_EMAIL,
      scope: `${CALENDAR_SCOPE} ${GMAIL_SEND_SCOPE}`,
    })

    expect(await (await GET(request())).json()).toEqual(sessionShape({ googleCalendar: false, gmail: false }))
  })

  it('fail-closes when the grant cannot be read', async () => {
    mocks.token.mockRejectedValue(new Error('token store unavailable'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(sessionShape({ googleCalendar: false, gmail: false }))
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('does not look up a grant when the signed-in user has no email', async () => {
    mocks.requireMobileUser.mockResolvedValue({ user: { id: 'actor-1', email: null } })

    const body = await (await GET(request())).json()

    expect(body.user.email).toBeNull()
    expect(body.capabilities.googleCalendar).toBe(false)
    expect(body.capabilities.gmail).toBe(false)
    expect(body.messaging.email.provider).toBe('none')
    expect(mocks.token).not.toHaveBeenCalled()
  })

  it('keeps an authentication failure off the capability lookup', async () => {
    mocks.requireMobileUser.mockRejectedValue(new MobileAuthError('Missing bearer token'))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'Missing bearer token' })
    expect(mocks.token).not.toHaveBeenCalled()
  })
})
