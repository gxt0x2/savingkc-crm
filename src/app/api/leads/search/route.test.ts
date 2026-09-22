import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import { OAUTH_REVIEW_SANDBOX_LEAD_ID } from '@/lib/auth/oauth-review-sandbox'

const mocks = vi.hoisted(() => ({
  sandbox: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/auth/oauth-review-sandbox-session', () => ({
  resolveOauthReviewSandboxLeadId: mocks.sandbox,
}))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { GET } from './route'

function chain(result: { data: unknown; error: null }) {
  const builder = {
    select: vi.fn(() => builder),
    or: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn().mockResolvedValue(result),
  }
  return builder
}

describe('lead search sandbox scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sandbox.mockResolvedValue(null)
  })

  it('keeps search open for real agents', async () => {
    const builder = chain({ data: [{ id: 'lead-1', full_name: 'Casey Seller' }], error: null })
    mocks.from.mockReturnValue(builder)

    const response = await GET(new NextRequest('https://crm.savingkc.com/api/leads/search?q=Casey'))

    expect(response.status).toBe(200)
    expect(builder.eq).not.toHaveBeenCalled()
    await expect(response.json()).resolves.toMatchObject({ results: [{ id: 'lead-1' }] })
  })

  it('returns only the sandbox lead for the oauth review account', async () => {
    mocks.sandbox.mockResolvedValue(OAUTH_REVIEW_SANDBOX_LEAD_ID)
    const builder = chain({ data: [{ id: OAUTH_REVIEW_SANDBOX_LEAD_ID, full_name: 'OAuth Demo' }], error: null })
    mocks.from.mockReturnValue(builder)

    const response = await GET(new NextRequest('https://crm.savingkc.com/api/leads/search?q=Ernest'))

    expect(response.status).toBe(200)
    expect(builder.eq).toHaveBeenCalledWith('id', OAUTH_REVIEW_SANDBOX_LEAD_ID)
    await expect(response.json()).resolves.toMatchObject({
      results: [{ id: OAUTH_REVIEW_SANDBOX_LEAD_ID }],
    })
  })
})
