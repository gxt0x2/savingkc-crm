import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireActor: vi.fn(),
  reserve: vi.fn(),
  complete: vi.fn(),
  getState: vi.fn(),
  queue: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileActor: mocks.requireActor,
}))
vi.mock('@/lib/mobile-api/command-receipts', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/command-receipts')>(),
  reserveMobileCommand: mocks.reserve,
  completeMobileCommand: mocks.complete,
}))
vi.mock('@/lib/server/canonical-lead-briefing', () => ({
  getCanonicalLeadBriefingState: mocks.getState,
  queueCanonicalLeadBriefing: mocks.queue,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { GET, POST } from './route'

const leadId = '1705b085-47c6-432d-9371-97dcabfc9bbc'
const context = { params: Promise.resolve({ id: leadId }) }
const request = (method: 'GET' | 'POST', key = 'briefing-key-1') => new NextRequest(`https://crm.savingkc.com/api/mobile/v1/leads/${leadId}/briefing`, {
  method,
  headers: { Authorization: 'Bearer token', ...(method === 'POST' ? { 'Idempotency-Key': key } : {}) },
  ...(method === 'POST' ? { body: '{}' } : {}),
})

describe('mobile canonical lead briefing route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireActor.mockResolvedValue({ actor: { email: 'ernest@savingkc.com', name: 'Ernest' } })
    mocks.admin.mockReturnValue({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { id: leadId }, error: null }) }) }) }) })
    mocks.getState.mockResolvedValue({ leadId, briefing: null, freshness: 'missing', refresh: null })
    mocks.reserve.mockResolvedValue({ kind: 'reserved' })
    mocks.queue.mockResolvedValue(4)
    mocks.complete.mockResolvedValue(undefined)
  })

  it('returns the canonical freshness state without client synthesis', async () => {
    const response = await GET(request('GET'), context)
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ leadId, freshness: 'missing', briefing: null })
  })

  it('queues one actor-owned refresh and replays an exact retry', async () => {
    const first = await POST(request('POST'), context)
    expect(first.status).toBe(202)
    await expect(first.json()).resolves.toMatchObject({ queued: true, revision: 4 })
    expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ requestedBy: 'ernest@savingkc.com' }))
    expect(mocks.complete).toHaveBeenCalledOnce()

    mocks.reserve.mockResolvedValue({ kind: 'replay', status: 202, result: { queued: true, leadId, revision: 4, status: 'pending' } })
    const replay = await POST(request('POST'), context)
    expect(replay.status).toBe(202)
    await expect(replay.json()).resolves.toMatchObject({ revision: 4 })
    expect(mocks.queue).toHaveBeenCalledOnce()
  })

  it('reports a queued refresh as accepted when only receipt reconciliation fails', async () => {
    mocks.complete.mockRejectedValue(new Error('receipt unavailable'))
    const response = await POST(request('POST'), context)
    expect(response.status).toBe(202)
    await expect(response.json()).resolves.toMatchObject({
      queued: true,
      revision: 4,
      warning: expect.stringMatching(/queued.*reconciliation/i),
    })
    expect(mocks.queue).toHaveBeenCalledOnce()
  })
})
