import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), read: vi.fn() }))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/county-prospect-audiences', () => ({ readCountyProspectAudienceSummary: mocks.read }))

import { GET } from './route'

describe('GET /api/prospecting/county-audiences', () => {
  beforeEach(() => vi.clearAllMocks())

  it('rejects an unauthenticated read before database work', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET()
    expect(response.status).toBe(401)
    expect(mocks.read).not.toHaveBeenCalled()
  })

  it('returns the server-owned aggregate without exposing prospect rows', async () => {
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', name: 'Ernest' })
    mocks.read.mockResolvedValue({ rows: [], classified: 0, needsPropertyClass: 24_482, withPhoneCandidate: 8_043 })
    const response = await GET()
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ rows: [], classified: 0, needsPropertyClass: 24_482, withPhoneCandidate: 8_043 })
  })
})
