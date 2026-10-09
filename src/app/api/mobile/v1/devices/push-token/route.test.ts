import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ user: vi.fn(), actor: vi.fn(), upsert: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.user }))
vi.mock('@/lib/mobile-api/authorized-lead', () => ({ resolveMobileScopedActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({ upsert: mocks.upsert }) }) }))
import { MobileAuthError } from '@/lib/mobile-api/auth'
import { POST } from './route'

const TOKEN = 'ExponentPushToken[device_123456789]'
function request(body: Record<string, unknown> = { token: TOKEN, platform: 'ios' }) {
  return new Request('https://crm.savingkc.com/api/mobile/v1/devices/push-token', { method: 'POST', body: JSON.stringify(body) }) as never
}
describe('mobile device registration', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
    vi.stubEnv('MOBILE_PUSH_ENABLED', '')
    vi.stubEnv('EXPO_ACCESS_TOKEN', '')
    mocks.user.mockResolvedValue({ user: { id: 'verified-user', email: 'ernest@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com' })
    mocks.upsert.mockResolvedValue({ error: null })
  })
  afterEach(() => {
    vi.unstubAllEnvs()
  })
  it('uses verified subject, unique-token upsert, and distinguishes registration from delivery', async () => {
    const response = await POST(request({ token: TOKEN, platform: 'ios', userId: 'someone-else' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, registered: true, deliveryConfigured: false })
    expect(mocks.upsert).toHaveBeenCalledWith(expect.objectContaining({ user_id: 'verified-user', token: TOKEN }), { onConflict: 'project_id,token' })
    expect(response.headers.get('Cache-Control')).toContain('no-store')
  })
  it('reports deliveryConfigured when the Expo send path is enabled', async () => {
    vi.stubEnv('MOBILE_PUSH_ENABLED', 'true')
    const response = await POST(request({ token: TOKEN, platform: 'ios' }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, registered: true, deliveryConfigured: true })
  })
  it('denies unauthenticated and unregistered subjects before writes', async () => {
    mocks.user.mockRejectedValueOnce(new MobileAuthError('Missing bearer token'))
    expect((await POST(request())).status).toBe(401)
    mocks.actor.mockResolvedValueOnce(null)
    expect((await POST(request())).status).toBe(403)
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('rejects non-Expo tokens, wrong platforms, and another project', async () => {
    for (const body of [{ token: 'https://attacker.test', platform: 'ios' }, { token: TOKEN, platform: 'web' }, { token: TOKEN, platform: 'ios', projectId: 'other' }]) {
      expect((await POST(request(body))).status).toBe(400)
    }
    expect(mocks.upsert).not.toHaveBeenCalled()
  })
  it('does not acknowledge persistence when schema or DB is unavailable', async () => {
    mocks.upsert.mockResolvedValue({ error: { message: 'private DB detail' } })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(JSON.stringify(await response.json())).not.toContain('private DB detail')
  })
})
