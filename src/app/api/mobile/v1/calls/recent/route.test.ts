import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

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
    mocks.admin.mockReturnValue({
      from: (table: string) => table === 'lead_activities'
        ? {
            select: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{
                      id: 'call-1', lead_id: 'lead-1', activity_type: 'call',
                      description: 'Outbound test call', created_at: '2026-09-18T18:00:00.000Z',
                      metadata: { source: 'twilio_status_callback', status: 'failed', to: '+18165550123' },
                    }],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        : {
            select: () => ({
              in: async () => ({
                data: [{ id: 'lead-1', full_name: 'Ernest Prenest', phone: '+18165550123' }],
                error: null,
              }),
            }),
          },
    })
  })

  it('returns canonical call activities and their linked sellers', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'call-1', leadId: 'lead-1', outcome: 'failed', phone: '+18165550123' }],
      leads: [{ id: 'lead-1', full_name: 'Ernest Prenest' }],
    })
  })

  it('still returns call rows when linked seller lookup fails', async () => {
    mocks.admin.mockReturnValue({
      from: (table: string) => table === 'lead_activities'
        ? {
            select: () => ({
              in: () => ({
                order: () => ({
                  limit: async () => ({
                    data: [{
                      id: 'call-1', lead_id: 'lead-1', activity_type: 'call',
                      description: 'Outbound test call', created_at: '2026-09-18T18:00:00.000Z',
                      metadata: { source: 'twilio_status_callback', status: 'completed', to: '+18165550123' },
                    }],
                    error: null,
                  }),
                }),
              }),
            }),
          }
        : {
            select: () => ({
              in: async () => ({ data: null, error: { message: 'leads unavailable' } }),
            }),
          },
    })

    const response = await GET(request())
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'call-1', phone: '+18165550123' }],
      leads: [],
    })
  })

  it('fails closed before reading call history', async () => {
    const { MobileAuthError } = await import('@/lib/mobile-api/auth')
    mocks.user.mockRejectedValue(new MobileAuthError('Invalid bearer token'))

    const response = await GET(request())

    expect(response.status).toBe(401)
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
