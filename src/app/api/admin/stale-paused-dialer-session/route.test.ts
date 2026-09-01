import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  actor: vi.fn(),
  find: vi.fn(),
  list: vi.fn(),
  clear: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireUserOrSecret: mocks.auth }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/stale-paused-dialer-session', () => ({
  StalePausedDialerSessionError: class StalePausedDialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  findStalePausedDialerHardStop: mocks.find,
  listStalePausedDialerHardStops: mocks.list,
  clearStalePausedDialerSession: mocks.clear,
}))

import { GET, POST } from './route'

const hardStop = {
  code: 'stale_paused_session_blocks_start',
  sessionId: '11355a3b-e5fa-4ecf-8cff-7720fa2428cb',
  campaignId: '74609ed4-7e26-4111-b626-b2e3f68efa0b',
  cannotStartNew: true,
}

describe('admin stale paused dialer session', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
    mocks.auth.mockResolvedValue(null)
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.find.mockResolvedValue(hardStop)
    mocks.list.mockResolvedValue([hardStop])
    mocks.clear.mockResolvedValue({ cleared: true, alreadyEnded: false, session: { id: hardStop.sessionId }, hardStop: null })
  })

  it('rejects anonymous reads before listing sessions', async () => {
    mocks.auth.mockResolvedValue(new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/admin/stale-paused-dialer-session') as never)
    expect(response.status).toBe(401)
    expect(mocks.list).not.toHaveBeenCalled()
  })

  it('returns the hard stop without caching or guessing CRON_SECRET', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/admin/stale-paused-dialer-session?campaign_id=74609ed4-7e26-4111-b626-b2e3f68efa0b') as never)
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('private, no-store')
    expect(mocks.find).toHaveBeenCalledWith({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      campaignId: '74609ed4-7e26-4111-b626-b2e3f68efa0b',
    })
    await expect(response.json()).resolves.toMatchObject({ hardStop, items: [hardStop] })
  })

  it('lets a signed-in acquisitions operator clear the wedged paused row', async () => {
    const response = await POST(new Request('https://crm.savingkc.com/api/admin/stale-paused-dialer-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId: hardStop.sessionId }),
    }) as never)
    expect(response.status).toBe(200)
    expect(mocks.clear).toHaveBeenCalledWith({
      sessionId: hardStop.sessionId,
      actorEmail: 'casey@savingkc.com',
      reason: 'stale_paused_session_cleared',
    })
  })

  it('blocks preview writes so inspection cannot end the live session', async () => {
    vi.stubEnv('VERCEL_ENV', 'preview')
    const response = await POST(new Request('https://preview.vercel.app/api/admin/stale-paused-dialer-session', {
      method: 'POST',
      body: JSON.stringify({ sessionId: hardStop.sessionId }),
    }) as never)
    expect(response.status).toBe(403)
    expect(mocks.clear).not.toHaveBeenCalled()
  })
})
