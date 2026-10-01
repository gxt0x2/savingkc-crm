import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(), requireAuthorizedMobileLead: mocks.authorize }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
import { GET } from './route'

describe('mobile conversation detail scope', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects an out-of-scope lead before reading activities', async () => {
    const { MobileLeadAccessError } = await import('@/lib/mobile-api/authorized-lead')
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('outside scope', 403))
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/conversations/lead-1'), { params: Promise.resolve({ id: 'lead-1' }) })
    expect(response.status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
