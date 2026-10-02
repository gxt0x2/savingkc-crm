import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ actor: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/mobile-command-access', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/mobile-command-access')>(), requireMobileCommandActor: mocks.actor }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
import { GET } from './route'

const request = () => new NextRequest('https://crm.savingkc.com/api/mobile/v1/conversations', { headers: { Authorization: 'Bearer token' } })

describe('mobile conversation list scope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ scopedActor: { email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] } })
  })

  it('filters assigned leads before limit and reads only their activities', async () => {
    const tables: string[] = []
    mocks.admin.mockReturnValue({ from: (table: string) => { tables.push(table); return table === 'leads'
      ? { select: () => ({ or: () => ({ or: () => ({ order: () => ({
        limit: () => ({ ilike: async (field: string, value: string) => { expect(field).toBe('assigned_agent'); expect(value).toBe('Casey'); return { data: [], error: null } } }),
      }) }) }) }) }
      : { select: () => ({ in: () => ({ in: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }) } },
    })
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [] })
    // Empty scoped page must not read global activities.
    expect(tables).toEqual(['leads'])
  })

  it('fails closed before database reads for an unregistered bearer', async () => {
    const { MobileCommandAccessError } = await import('@/lib/mobile-api/mobile-command-access')
    mocks.actor.mockRejectedValue(new MobileCommandAccessError('CRM profile not authorized', 403))
    expect((await GET(request())).status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
