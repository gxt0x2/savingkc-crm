import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  actor: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/api/require-authenticated-user', () => ({
  requireAuthenticatedUser: mocks.requireUser,
}))
vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { GET, POST } from './route'

describe('legacy manifest collection trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireUser.mockResolvedValue(null)
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('rejects anonymous reads before service-role access', async () => {
    mocks.requireUser.mockResolvedValue(
      NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    )

    const response = await GET(new NextRequest('https://crm.savingkc.com/api/manifests?lead_id=lead-1'))

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('rejects anonymous creates before parsing or service-role access', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = new NextRequest('https://crm.savingkc.com/api/manifests', {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Seller', phone: '+18165550100' }),
    })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
