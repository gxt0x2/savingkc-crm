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

import { GET, POST } from './route'

const report = {
  apply: false,
  examined: 1,
  stored: 0,
  alreadyStored: 0,
  pending: 1,
  storedSids: [],
  notFound: [],
  empty: [],
  failed: [],
}

describe('admin inbound MMS backfill', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.load.mockResolvedValue([{ id: 'activity-mms' }])
    mocks.run.mockResolvedValue(report)
  })

  it('rejects an unauthorized request before reading activities', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/backfill-inbound-mms', {
      method: 'POST',
      body: JSON.stringify({ apply: true }),
    }))
    expect(response.status).toBe(401)
    expect(mocks.load).not.toHaveBeenCalled()
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('previews a 30 day window unless apply is set', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/admin/backfill-inbound-mms?messageSid=MM' + 'a'.repeat(32)))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    await expect(response.json()).resolves.toMatchObject({ ok: true, pending: 1 })
    expect(mocks.load).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      messageSid: `MM${'a'.repeat(32)}`,
      limit: 100,
    }))
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ apply: false }))
  })

  it('applies only when the admin post asks it to', async () => {
    mocks.run.mockResolvedValue({ ...report, apply: true, pending: 0, stored: 1, storedSids: [`MM${'a'.repeat(32)}`] })
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/backfill-inbound-mms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ apply: true, days: 30, messageSid: `MM${'a'.repeat(32)}` }),
    }))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ apply: true }))
  })

  it('rejects a window outside the last 30 days', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/backfill-inbound-mms', {
      method: 'POST',
      body: JSON.stringify({ apply: true, days: 90 }),
    }))
    expect(response.status).toBe(400)
    expect(mocks.load).not.toHaveBeenCalled()
  })
})
