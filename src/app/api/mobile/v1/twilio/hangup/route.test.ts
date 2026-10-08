import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), actor: vi.fn(), hangup: vi.fn(), sweep: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user }))
vi.mock('@/lib/mobile-api/authorized-lead', () => ({ resolveMobileScopedActor: mocks.actor }))
vi.mock('@/lib/telephony/mobile-voice-hangup', async (original) => ({
  ...await original<typeof import('@/lib/telephony/mobile-voice-hangup')>(),
  hangupMobileVoiceCall: mocks.hangup,
  hangupActiveClientOutboundCalls: mocks.sweep,
}))
import { MobileAuthError } from '@/lib/mobile-api/auth'
import { MobileHangupError } from '@/lib/telephony/mobile-voice-hangup'
import { POST } from './route'
const sid = `CA${'a'.repeat(32)}`
const request = () => new Request('https://crm.savingkc.com/api/mobile/v1/twilio/hangup', { method: 'POST', body: JSON.stringify({ callSid: sid, identity: 'casey' }) }) as never
describe('mobile hangup route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.mockResolvedValue({ user: { email: 'ernest@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com' })
    mocks.hangup.mockResolvedValue('disconnected')
    mocks.sweep.mockResolvedValue('disconnected')
  })
  it('binds the hangup to the bearer identity, never client input', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.hangup).toHaveBeenCalledWith(sid, 'ernest')
    expect(mocks.sweep).not.toHaveBeenCalled()
  })
  it('sweeps the bearer identity when End has no call SID yet', async () => {
    const pending = new Request('https://crm.savingkc.com/api/mobile/v1/twilio/hangup', {
      method: 'POST',
      body: JSON.stringify({ clientAttemptId: 'attempt-1' }),
    }) as never
    expect((await POST(pending)).status).toBe(200)
    expect(mocks.sweep).toHaveBeenCalledWith('ernest')
    expect(mocks.hangup).not.toHaveBeenCalled()
  })
  it('fails closed for unauthenticated, unregistered, and other-agent calls', async () => {
    mocks.user.mockRejectedValueOnce(new MobileAuthError('Missing bearer token'))
    expect((await POST(request())).status).toBe(401)
    mocks.actor.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.hangup).not.toHaveBeenCalled()
    mocks.hangup.mockRejectedValueOnce(new MobileHangupError('Call not found for this user', 404))
    expect((await POST(request())).status).toBe(404)
  })
})
