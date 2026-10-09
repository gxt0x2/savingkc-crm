import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn(), actor: vi.fn(), hangup: vi.fn(), attempt: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user }))
vi.mock('@/lib/mobile-api/authorized-lead', () => ({ resolveMobileScopedActor: mocks.actor }))
vi.mock('@/lib/telephony/mobile-voice-hangup', async (original) => ({
  ...await original<typeof import('@/lib/telephony/mobile-voice-hangup')>(),
  hangupMobileVoiceCall: mocks.hangup,
  hangupMobileVoiceAttempt: mocks.attempt,
}))
import { MobileAuthError } from '@/lib/mobile-api/auth'
import { MobileHangupError } from '@/lib/telephony/mobile-voice-hangup'
import { POST } from './route'
const sid = `CA${'a'.repeat(32)}`
const request = () => new Request('https://crm.savingkc.com/api/mobile/v1/twilio/hangup', { method: 'POST', body: JSON.stringify({ callSid: sid, identity: 'casey' }) }) as never
const pending = (body: Record<string, unknown> = { clientAttemptId: 'attempt-1' }) => new Request('https://crm.savingkc.com/api/mobile/v1/twilio/hangup', {
  method: 'POST',
  body: JSON.stringify(body),
}) as never
describe('mobile hangup route', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.mockResolvedValue({ user: { email: 'ernest@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com' })
    mocks.hangup.mockResolvedValue('disconnected')
    mocks.attempt.mockResolvedValue('end_requested')
  })
  it('binds the hangup to the bearer identity, never client input', async () => {
    expect((await POST(request())).status).toBe(200)
    expect(mocks.hangup).toHaveBeenCalledWith(sid, 'ernest')
    expect(mocks.attempt).not.toHaveBeenCalled()
  })
  it('stores End for the bearer identity attempt when the phone has no call SID yet', async () => {
    const response = await POST(pending({ clientAttemptId: 'attempt-1', identity: 'casey' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, result: 'end_requested' })
    expect(mocks.attempt).toHaveBeenCalledWith('ernest', 'attempt-1')
    expect(mocks.hangup).not.toHaveBeenCalled()
  })
  it('keeps Casey on her own identity', async () => {
    mocks.user.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com' })
    expect((await POST(pending())).status).toBe(200)
    expect(mocks.attempt).toHaveBeenCalledWith('casey', 'attempt-1')
    expect((await POST(request())).status).toBe(200)
    expect(mocks.hangup).toHaveBeenCalledWith(sid, 'casey')
  })
  it('asks the phone to retry when End could not be stored', async () => {
    mocks.attempt.mockRejectedValueOnce(new MobileHangupError('Could not confirm that the call ended. Retry End.', 503))
    const response = await POST(pending())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ ok: false, error: 'Could not confirm that the call ended. Retry End.' })
  })
  it('fails closed for unauthenticated, unregistered, and other-agent calls', async () => {
    mocks.user.mockRejectedValueOnce(new MobileAuthError('Missing bearer token'))
    expect((await POST(request())).status).toBe(401)
    mocks.actor.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.hangup).not.toHaveBeenCalled()
    mocks.hangup.mockRejectedValueOnce(new MobileHangupError('Call not found for this user', 404))
    expect((await POST(request())).status).toBe(404)
    expect((await POST(pending({}))).status).toBe(400)
    expect(mocks.attempt).not.toHaveBeenCalled()
  })
})
