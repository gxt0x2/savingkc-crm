import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
  admin: vi.fn(),
}))

vi.mock('@supabase/supabase-js', () => ({ createClient: mocks.createClient }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/supabase/env', () => ({
  getSupabaseUrl: () => 'https://project.supabase.co',
  getSupabasePublicKey: () => 'public-key',
  getSupabaseAdminKey: () => 'service-key',
}))

import { GET } from './route'

const SANDBOX = '+19137179716'

function request(threadId: string, authorization?: string) {
  return new NextRequest(`https://crm.savingkc.com/api/mobile/v1/conversations/${encodeURIComponent(threadId)}`, {
    headers: authorization ? { Authorization: authorization } : {},
  })
}

describe('mobile phone thread bearer reads', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createClient.mockReturnValue({ auth: { getUser: mocks.getUser } })
    mocks.getUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'ernest@savingkc.com' } },
      error: null,
    })
    mocks.admin.mockReturnValue({
      from: (table: string) => {
        if (table === 'agent_profiles') {
          return {
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { email: 'ernest@savingkc.com', full_name: 'Ernest', role: 'owner', is_admin: true },
                  error: null,
                }),
              }),
            }),
          }
        }
        if (table !== 'lead_activities') throw new Error(`unexpected table ${table}`)
        const query = {
          select: () => query,
          eq: () => query,
          in: () => query,
          is: () => query,
          order: () => query,
          or: () => query,
          limit: async () => ({
            data: [{
              id: 'sandbox-sms',
              activity_type: 'sms',
              description: 'Sandbox reply',
              agent: 'System',
              metadata: { direction: 'received', from: SANDBOX },
              created_at: '2026-11-01T12:00:00.000Z',
            }],
            error: null,
          }),
        }
        return query
      },
    })
  })

  it.each([`unmatched:${SANDBOX}`, `phone:${SANDBOX}`])('opens %s for a verified bearer token', async (threadId) => {
    const response = await GET(request(threadId, 'Bearer verified-token'), { params: Promise.resolve({ id: threadId }) })

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.contact).toMatchObject({ id: `unmatched:${SANDBOX}`, phone: SANDBOX, source: 'unmatched_activity' })
    expect(body.activities.map((activity: { id: string }) => activity.id)).toEqual(['sandbox-sms'])
    expect(mocks.getUser).toHaveBeenCalledWith('verified-token')
    expect(response.headers.get('cache-control')).toContain('no-store')
  })

  it('rejects a phone thread when the bearer token is missing', async () => {
    const response = await GET(request(`unmatched:${SANDBOX}`), {
      params: Promise.resolve({ id: `unmatched:${SANDBOX}` }),
    })

    expect(response.status).toBe(401)
    expect(mocks.getUser).not.toHaveBeenCalled()
    expect(mocks.admin).not.toHaveBeenCalled()
  })
})
