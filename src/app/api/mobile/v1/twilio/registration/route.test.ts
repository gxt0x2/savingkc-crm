import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ user: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user }))
import { MobileAuthError } from '@/lib/mobile-api/auth'
import { POST } from './route'

const request = (body: unknown) => new Request('https://crm.savingkc.com/api/mobile/v1/twilio/registration', {
  method: 'POST',
  body: JSON.stringify(body),
}) as never

describe('mobile voice registration telemetry', () => {
  let info: ReturnType<typeof vi.spyOn>
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.user.mockResolvedValue({ user: { email: 'Ernest@SavingKC.com' } })
    info = vi.spyOn(console, 'info').mockImplementation(() => undefined)
  })
  afterEach(() => info.mockRestore())

  it('logs the register() result under the bearer identity only', async () => {
    const response = await POST(request({ outcome: 'registered', pushRegistryReady: true, incomingPushConfigured: true, identity: 'casey' }))
    expect(response.status).toBe(200)
    expect(info).toHaveBeenCalledWith('[mobile-voice-registration]', expect.objectContaining({
      identity: 'ernest', outcome: 'registered', pushRegistryReady: true, incomingPushConfigured: true,
    }))
  })

  it('bounds untrusted fields and maps unknown outcomes', async () => {
    await POST(request({ outcome: 'drop table', code: 'x'.repeat(50), message: 'm'.repeat(500) }))
    const logged = info.mock.calls[0][1] as Record<string, unknown>
    expect(logged.outcome).toBe('unknown')
    expect(String(logged.code)).toHaveLength(12)
    expect(String(logged.message)).toHaveLength(200)
    expect(logged.pushRegistryReady).toBe(false)
  })

  it('rejects a missing bearer without logging', async () => {
    mocks.user.mockRejectedValue(new MobileAuthError('Missing bearer token'))
    expect((await POST(request({ outcome: 'registered' }))).status).toBe(401)
    expect(info).not.toHaveBeenCalled()
  })
})
