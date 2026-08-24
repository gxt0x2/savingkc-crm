import { NextResponse } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminOrSecret: vi.fn(),
  claim: vi.fn(),
  generate: vi.fn(),
  finish: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({ requireAdminOrSecret: mocks.requireAdminOrSecret }))
vi.mock('@/lib/server/canonical-lead-briefing', () => ({
  claimCanonicalLeadBriefings: mocks.claim,
  generateCanonicalLeadBriefing: mocks.generate,
  finishCanonicalLeadBriefing: mocks.finish,
}))

import { GET } from './route'

const claim = {
  leadId: '11111111-1111-4111-8111-111111111111',
  revision: 2,
  claimToken: '22222222-2222-4222-8222-222222222222',
  reason: 'activity_changed',
  requestedBy: 'system:activity_trigger',
}

describe('canonical briefing worker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminOrSecret.mockResolvedValue(null)
    mocks.claim.mockResolvedValue([claim])
    mocks.generate.mockResolvedValue({ generationId: 'generation-1' })
    mocks.finish.mockResolvedValue('completed')
  })

  it('stops before claiming work when authorization fails', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(NextResponse.json({ error: 'Unauthorized' }, { status: 401 }))
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sweep-briefings'))

    expect(response.status).toBe(401)
    expect(mocks.claim).not.toHaveBeenCalled()
  })

  it('claims a tiny batch, generates through the service, and completes the revision', async () => {
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sweep-briefings'))

    expect(response.status).toBe(200)
    expect(mocks.claim).toHaveBeenCalledWith(3)
    expect(mocks.generate).toHaveBeenCalledWith({ claim })
    expect(mocks.finish).toHaveBeenCalledWith({ claim, success: true })
    await expect(response.json()).resolves.toMatchObject({ claimed: 1, completed: 1, source: 'canonical_briefing_jobs' })
  })

  it('returns failed provider work to the durable retry state', async () => {
    mocks.generate.mockRejectedValue(new Error('provider unavailable'))
    mocks.finish.mockResolvedValue('retry')
    const response = await GET(new Request('https://crm.savingkc.com/api/cron/sweep-briefings'))

    expect(response.status).toBe(200)
    expect(mocks.finish).toHaveBeenCalledWith({ claim, success: false, error: 'provider unavailable' })
    await expect(response.json()).resolves.toMatchObject({ completed: 0, retrying: 1, failed: 0 })
  })
})
