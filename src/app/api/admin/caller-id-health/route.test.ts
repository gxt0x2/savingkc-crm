import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  summarize: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/telephony/caller-id-health-run', () => ({ summarizeCallerIdHealth: mocks.summarize }))
vi.mock('@/lib/telephony/caller-id-health-db', () => ({ callerIdHealthStore: () => ({}) }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { GET } from './route'

describe('/api/admin/caller-id-health', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.summarize.mockResolvedValue({
      ok: true,
      readOnly: true,
      activeSet: ['+18166404701'],
      proposedActiveSet: ['+18166404701'],
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
    await expect(response.json()).resolves.toMatchObject({ ok: true, readOnly: true, activeSet: ['+18166404701'] })
    expect(mocks.summarize).toHaveBeenCalledOnce()
  })
})
