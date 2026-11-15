import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminOrSecret: vi.fn(),
  executeTaxStatusBatch: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({
  requireAdminOrSecret: mocks.requireAdminOrSecret,
}))

vi.mock('@/lib/tax-status/persist', () => ({
  executeTaxStatusBatch: mocks.executeTaxStatusBatch,
  TaxStatusStoreError: class TaxStatusStoreError extends Error {},
}))

import { GET } from './route'

describe('GET /api/cron/tax-status-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminOrSecret.mockResolvedValue(null)
  })

  it('returns the batch summary and does not claim a Mojo write', async () => {
    mocks.executeTaxStatusBatch.mockResolvedValue({
      phase: 'nightly',
      allowAdd: true,
      mojoWriteApi: null,
      checked: 2,
    })
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/tax-status-verification'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, phase: 'nightly', mojoWriteApi: null })
  })

  it('rejects a request without the cron or admin secret', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/tax-status-verification'))
    expect(response.status).toBe(401)
    expect(mocks.executeTaxStatusBatch).not.toHaveBeenCalled()
  })
})
