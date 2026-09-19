import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  hangup: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/telephony/mobile-voice-hangup', () => ({
  hangupMobileVoiceCall: mocks.hangup,
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/twilio/hangup', {
    method: 'POST',
    headers: { Authorization: 'Bearer user', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('mobile Twilio hangup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.hangup.mockResolvedValue('disconnected')
  })

  it('hangs up a real Twilio call SID for a signed-in operator', async () => {
    const response = await POST(request({ callSid: `CA${'a'.repeat(32)}` }))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ ok: true, result: 'disconnected' })
    expect(mocks.hangup).toHaveBeenCalledTimes(1)
  })

  it('fails closed before touching Twilio when unauthenticated', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.user.mockRejectedValue(new MobileAuthError('Invalid bearer token'))
    const response = await POST(request({ callSid: `CA${'a'.repeat(32)}` }))
    expect(response.status).toBe(401)
    expect(mocks.hangup).not.toHaveBeenCalled()
  })

  it('returns 503 without exposing secrets when Voice hangup is unconfigured', async () => {
    mocks.hangup.mockRejectedValue(new Error('Calling is temporarily unavailable'))
    const response = await POST(request({ callSid: `CA${'a'.repeat(32)}` }))
    const body = await response.json()
    expect(response.status).toBe(503)
    expect(body).toEqual({ ok: false, error: 'Calling is temporarily unavailable' })
    expect(JSON.stringify(body)).not.toContain('TWILIO_')
  })
})
