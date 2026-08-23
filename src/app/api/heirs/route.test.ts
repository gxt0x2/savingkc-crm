import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireUser,
}))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { GET } from './route'

describe('heir read trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(null)
  })

  it('rejects anonymous reads before CRM access', async () => {
    mocks.requireUser.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const response = await GET(new Request('https://crm.savingkc.com/api/heirs?lead_id=lead-1'))

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
