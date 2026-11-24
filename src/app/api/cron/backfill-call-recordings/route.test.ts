import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  run: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.auth }))
vi.mock('@/lib/server/call-recording-archive', () => ({
  RECORDING_ARCHIVE_RATE_LIMIT_MS: 1000,
  runStoredRecordingBackfill: mocks.run,
}))

import { GET, POST } from './route'

const dryRun = {
  dryRun: true,
  wouldArchive: { mojoEvents: 2, mojoCalls: 1, twilioAttempts: 2, total: 5 },
  alreadyStored: { mojoEvents: 1, mojoCalls: 0, twilioAttempts: 1, total: 2 },
  mojoCallsAwaitingUrl: 1,
  archived: 0,
  alreadyStoredThisRun: 0,
  skipped: 0,
  failed: 0,
  nextCursor: null,
}

describe('/api/cron/backfill-call-recordings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.run.mockResolvedValue(dryRun)
  })

  it('stays a dry-run unless apply=1 is explicit', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/backfill-call-recordings'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ ok: true, dryRun: true, wouldArchive: { total: 5 } })
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ apply: false, rateLimitMs: 0 }))
  })

  it('rejects an untrusted caller before counting recordings', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/backfill-call-recordings?apply=1'))
    expect(response.status).toBe(401)
    expect(mocks.run).not.toHaveBeenCalled()
  })

  it('keeps apply=1 on GET as a dry-run', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/backfill-call-recordings?apply=1'))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ apply: false, rateLimitMs: 0 }))
  })

  it('applies one rate-limited page only from POST', async () => {
    mocks.run.mockResolvedValue({ ...dryRun, dryRun: false, archived: 2 })
    const response = await POST(new Request('https://crm.savingkc.com/api/cron/backfill-call-recordings?apply=1&cursor=2026-08-01&limit=2', { method: 'POST' }))
    expect(response.status).toBe(200)
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({
      apply: true,
      cursor: '2026-08-01',
      limit: 2,
      rateLimitMs: 1000,
    }))
  })
})
