import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  summarize: vi.fn(),
  save: vi.fn(),
  saveTarget: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/telephony/caller-id-health-run', () => ({ summarizeCallerIdHealth: mocks.summarize }))
vi.mock('@/lib/telephony/caller-id-health-db', () => ({
  callerIdHealthStore: () => ({}),
  saveCallerId: mocks.save,
  saveCallerIdActiveTarget: mocks.saveTarget,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { GET, POST } from './route'

describe('/api/admin/caller-id-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.summarize.mockResolvedValue({
      ok: true,
      readOnly: true,
      activeSet: ['+18165550100'],
      proposedActiveSet: ['+18165550100'],
      actions: [],
    })
  })

  it('rejects an untrusted request before summarizing the pool', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/admin/caller-id-health') as never)
    expect(response.status).toBe(401)
    expect(mocks.summarize).not.toHaveBeenCalled()
  })

  it('returns a read-only summary and does not apply a rest', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/admin/caller-id-health') as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toContain('no-store')
    await expect(response.json()).resolves.toMatchObject({ ok: true, readOnly: true, activeSet: ['+18165550100'] })
    expect(mocks.summarize).toHaveBeenCalledOnce()
  })

  it('refuses a released number before writing', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/caller-id-health', {
      method: 'POST',
      body: JSON.stringify({ phone: '+18166404701', status: 'active', mojoVerified: true }),
    }) as never)
    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({ code: 'released_caller_id' })
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('loads a verified number and can set the active target', async () => {
    mocks.save.mockResolvedValue({ phone: '+18165550100', status: 'spare' })
    const loaded = await POST(new Request('https://crm.savingkc.com/api/admin/caller-id-health', {
      method: 'POST',
      body: JSON.stringify({ phone: '8165550100', status: 'spare', mojoVerified: true }),
    }) as never)
    expect(loaded.status).toBe(200)
    expect(mocks.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ phone: '+18165550100', status: 'spare' }))

    const target = await POST(new Request('https://crm.savingkc.com/api/admin/caller-id-health', {
      method: 'POST',
      body: JSON.stringify({ activeTarget: 10 }),
    }) as never)
    expect(target.status).toBe(200)
    expect(mocks.saveTarget).toHaveBeenCalledWith(expect.anything(), 10)
  })
})
