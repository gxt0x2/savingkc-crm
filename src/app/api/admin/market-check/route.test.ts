import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/auth/admin', () => ({ isUserAdmin: mocks.admin }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }))

import { POST } from './route'

describe('POST /api/admin/market-check', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('rejects a caller who is not signed in', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/admin/market-check', { method: 'POST' }))
    expect(response.status).toBe(401)
  })

  it('rejects a signed-in user who is not an admin', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com' })
    mocks.admin.mockResolvedValue(false)
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/admin/market-check', {
      method: 'POST',
      body: JSON.stringify({ csv: 'St,Address,Zip\nActive,1 Main,64114' }),
      headers: { 'content-type': 'application/json' },
    }))
    expect(response.status).toBe(403)
  })
})
