import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  load: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ from: () => ({}) }) }))
vi.mock('@/lib/server/inbound-mms-backfill', async (original) => {
  const actual = await original<typeof import('@/lib/server/inbound-mms-backfill')>()
  return { ...actual, loadInboundMmsBackfillRows: mocks.load, backfillInboundMmsActivities: mocks.run }
})

import { GET } from './route'

describe('cron inbound MMS backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.load.mockResolvedValue([])
    mocks.run.mockResolvedValue({
      apply: true,
      examined: 4,
      stored: 4,
      alreadyStored: 0,
      pending: 0,
      storedSids: [],
      notFound: [],
      empty: [],
      failed: [],
    })
  })

  it('rejects an unauthorized cron before reading activities', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/backfill-inbound-mms'))
    expect(response.status).toBe(401)
    expect(mocks.load).not.toHaveBeenCalled()
  })

  it('applies the last 30 days for a trusted cron', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/backfill-inbound-mms'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({ ok: true, stored: 4 })
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ apply: true }))
    expect(mocks.load.mock.calls[0]?.[1]).toMatchObject({ limit: 100 })
  })
})
