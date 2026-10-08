import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ authorize: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/authorized-lead', async (original) => ({ ...await original<typeof import('@/lib/mobile-api/authorized-lead')>(), requireAuthorizedMobileLead: mocks.authorize }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
import { POST } from './route'

describe('mobile call-event scope', () => {
  beforeEach(() => vi.clearAllMocks())
  it('rejects an out-of-scope lead before inserting or touching a timestamp', async () => {
    const { MobileLeadAccessError } = await import('@/lib/mobile-api/authorized-lead')
    mocks.authorize.mockRejectedValue(new MobileLeadAccessError('outside scope', 403))
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/events', {
      method: 'POST', body: JSON.stringify({ leadId: 'lead-1', phone: '+18165550123', event: 'started' }),
    }))
    expect(response.status).toBe(403)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
  it('skips a lead write for an ad-hoc dial instead of inventing a lead', async () => {
    for (const leadId of [undefined, '']) {
      const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/events', {
        method: 'POST', body: JSON.stringify({ leadId, phone: '(816) 553-7559', event: 'ended' }),
      }))
      expect(response.status).toBe(200)
      expect(await response.json()).toMatchObject({
        ok: true,
        activityId: null,
        skipped: true,
      })
    }
    expect(mocks.authorize).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })

  it('still requires phone and event', async () => {
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/events', {
      method: 'POST', body: JSON.stringify({ leadId: 'lead-1' }),
    }))
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'phone and event are required' })
    expect(mocks.authorize).not.toHaveBeenCalled()
  })

  it('stores the verified actor instead of a client-supplied agent', async () => {
    mocks.authorize.mockResolvedValue({ actor: { fullName: 'Casey' }, user: { id: 'user-casey', email: 'casey@savingkc.com' } })
    const inserted: Array<Record<string, unknown>> = []
    mocks.admin.mockReturnValue({ from: (table: string) => table === 'lead_activities'
      ? { insert: (row: Record<string, unknown>) => { inserted.push(row); return { select: () => ({ single: async () => ({ data: { id: 'call-1' }, error: null }) }) } } }
      : { update: () => ({ eq: async () => ({ error: null }) }) },
    })
    const response = await POST(new NextRequest('https://crm.savingkc.com/api/mobile/v1/calls/events', {
      method: 'POST', body: JSON.stringify({ leadId: 'lead-1', phone: '+18165550123', event: 'started', agent: 'Ernest' }),
    }))
    expect(response.status).toBe(200)
    expect(inserted[0]).toMatchObject({ agent: 'Casey', lead_id: 'lead-1', metadata: { userId: 'user-casey', userEmail: 'casey@savingkc.com' } })
  })
})
