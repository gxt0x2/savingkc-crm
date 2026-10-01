import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ user: vi.fn(), actor: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(),
  resolveMobileScopedActor: mocks.actor,
}))

import { GET } from './route'

function request() {
  return new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/recent', {
    headers: { Authorization: 'Bearer user' },
  })
}

describe('mobile recent calls route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({ user: { email: 'ernest@savingkc.com' } })
    mocks.actor.mockResolvedValue({ email: 'ernest@savingkc.com', fullName: 'Ernest', access: 'owner', assignmentAliases: [] })
    mocks.admin.mockReturnValue({
      from: (table: string) => table === 'lead_activities'
        ? { select: () => ({ in: () => ({ order: () => ({ limit: async () => ({
          data: [{ id: 'call-1', lead_id: 'lead-1', activity_type: 'call', created_at: '2026-10-01T12:00:00Z', metadata: { status: 'failed', to: '+18165550123' } }], error: null,
        }) }) }) }) }
        : { select: () => ({ in: async () => ({ data: null, error: { message: 'linked lead unavailable' } }) }) },
    })
  })

  it('returns call evidence even if linked lead enrichment fails', async () => {
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ items: [{ id: 'call-1', outcome: 'failed' }], leads: [] })
  })

  it('requires a bearer user before reading calls', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.user.mockRejectedValue(new MobileAuthError('Invalid bearer token'))
    const response = await GET(request())
    expect(response.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('does not return another operator’s calls to an agent', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] })
    mocks.admin.mockReturnValue({
      from: (table: string) => table === 'lead_activities'
        ? { select: () => ({ in: () => ({ order: () => ({ limit: async () => ({
          data: [{ id: 'call-1', lead_id: 'lead-1', activity_type: 'call', created_at: '2026-10-01T12:00:00Z', metadata: { to: '+18165550123' } }], error: null,
        }) }) }) }) }
        : { select: () => ({ in: async () => ({ data: [{ id: 'lead-1', assigned_agent: 'Ernest' }], error: null }) }) },
    })
    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ items: [], leads: [] })
  })
})
