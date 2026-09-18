import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ user: vi.fn(), admin: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (original) => ({
  ...await original<typeof import('@/lib/mobile-api/auth')>(),
  requireMobileUser: mocks.user,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))

import { GET } from './route'

describe('mobile conversations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.user.mockResolvedValue({
      user: { app_metadata: { pinned_chat_ids: ['lead-1'] } },
    })
    const leadResult = {
      data: [{
        id: 'lead-1',
        full_name: 'Morgan Seller',
        phone: '8165550100',
        email: null,
        property_address: '123 Main St',
        city: 'Kansas City',
        station: 'qualified',
        priority: 'normal',
        assigned_agent: 'Casey',
        created_at: '2026-09-01T12:00:00Z',
        is_favorite: true,
      }],
      error: null,
    }
    const activityResult = {
      data: [{
        id: 'sms-1',
        lead_id: 'lead-1',
        activity_type: 'sms',
        description: 'Call me tomorrow',
        agent: null,
        metadata: { direction: 'inbound' },
        created_at: '2026-09-18T12:00:00Z',
      }],
      error: null,
    }
    mocks.admin.mockReturnValue({
      from: (table: string) => table === 'leads'
        ? {
            select: () => ({
              or: () => ({
                or: () => ({
                  order: () => ({ limit: () => Promise.resolve(leadResult) }),
                }),
              }),
            }),
          }
        : {
            select: () => ({
              in: () => ({
                in: () => ({
                  order: () => ({ limit: () => Promise.resolve(activityResult) }),
                }),
              }),
            }),
          },
    })
  })

  it('returns user-specific chat pins separately from lead favorites', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/conversations', {
      headers: { Authorization: 'Bearer user' },
    }))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      items: [{ id: 'lead-1', pinned: true, is_favorite: true }],
    })
  })
})
