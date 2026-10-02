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

  it('filters calls by trusted assignment before the recent page limit', async () => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] })
    const steps: string[] = []
    mocks.admin.mockReturnValue({
      from: (table: string) => {
        expect(table).toBe('lead_activities')
        return {
          select: (columns: string) => { steps.push('select'); expect(columns).toContain('leads!inner'); return {
            in: () => { steps.push('in'); return {
              ilike: (column: string, owner: string) => { steps.push('scope'); expect(column).toBe('leads.assigned_agent'); expect(owner).toBe('Casey'); return {
                order: () => { steps.push('order'); return {
                  limit: async () => { steps.push('limit'); return { data: [{ id: 'call-casey', lead_id: 'lead-casey', activity_type: 'call', created_at: '2026-10-01T12:00:00Z', metadata: { to: '+18165550123' }, leads: { id: 'lead-casey', assigned_agent: 'Casey' } }], error: null } },
                } },
              } },
            } },
          } },
        }
      },
    })
    const response = await GET(request())
    expect(response.status).toBe(200)
    expect(steps).toEqual(['select', 'in', 'scope', 'order', 'limit'])
    await expect(response.json()).resolves.toMatchObject({ items: [{ id: 'call-casey' }], leads: [{ id: 'lead-casey' }] })
  })

  it.each([
    { name: 'one-row relation array', leads: [{ id: 'lead-casey', assigned_agent: 'Casey' }], visible: true },
    { name: 'mismatched lead', leads: { id: 'lead-other', assigned_agent: 'Casey' }, visible: false },
    { name: 'different owner', leads: { id: 'lead-casey', assigned_agent: 'Other' }, visible: false },
    { name: 'ambiguous relation', leads: [{ id: 'lead-casey', assigned_agent: 'Casey' }, { id: 'lead-other', assigned_agent: 'Casey' }], visible: false },
    { name: 'missing relation', leads: null, visible: false },
  ])('validates the joined lead: $name', async ({ leads, visible }) => {
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', fullName: 'Casey', access: 'agent', assignmentAliases: ['Casey'] })
    const query = {
      select: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(),
      ilike: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ data: [{ id: 'call-casey', lead_id: 'lead-casey', activity_type: 'call', created_at: '2026-10-01T12:00:00Z', metadata: {}, leads }], error: null }),
    }
    mocks.admin.mockReturnValue({ from: () => query })
    const response = await GET(request())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.items.map((item: { id: string }) => item.id)).toEqual(visible ? ['call-casey'] : [])
    expect(body.leads.map((lead: { id: string }) => lead.id)).toEqual(visible ? ['lead-casey'] : [])
  })
})
