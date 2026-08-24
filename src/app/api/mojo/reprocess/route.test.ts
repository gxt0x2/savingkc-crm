import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminOrSecret: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({
  requireAdminOrSecret: mocks.requireAdminOrSecret,
}))

import { POST } from './route'

describe('/api/mojo/reprocess containment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects an untrusted caller before reading manifests or starting AI work', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    )

    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/reprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }))

    expect(response.status).toBe(401)
  })

  it('returns an explicit no-store retirement response to trusted operators', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(null)
    const response = await POST(new Request('https://crm.savingkc.com/api/mojo/reprocess', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
    }))

    expect(response.status).toBe(410)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    await expect(response.json()).resolves.toMatchObject({ code: 'mojo_reprocess_retired' })
  })
})
