import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getClaims: vi.fn(),
  profileMaybeSingle: vi.fn(),
  insert: vi.fn(),
  activityLimit: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getClaims: mocks.getClaims } }),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { GET, POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/leads/lead-1/activities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

function getRequest() {
  return new NextRequest('https://crm.savingkc.com/api/leads/lead-1/activities?limit=25')
}

describe('lead internal notes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getClaims.mockResolvedValue({
      data: { claims: { sub: 'user-ernest', email: 'ernest@savingkc.com' } },
      error: null,
    })
    mocks.profileMaybeSingle.mockResolvedValue({ data: { full_name: 'Ernest Dodson' }, error: null })
    mocks.activityLimit.mockResolvedValue({
      data: [{ id: 'activity-1', activity_type: 'sms', created_at: '2026-08-23T12:00:00.000Z' }],
      error: null,
    })
    mocks.from.mockImplementation((table: string) => {
      if (table === 'agent_profiles') {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: mocks.profileMaybeSingle }),
          }),
        }
      }
      return {
        select: () => ({
          eq: () => ({
            order: () => ({ limit: mocks.activityLimit }),
          }),
        }),
        insert: (payload: unknown) => {
          mocks.insert(payload)
          return {
            select: () => ({
              single: async () => ({ data: { id: 'activity-1', ...(payload as object) }, error: null }),
            }),
          }
        },
      }
    })
  })

  it('attributes notes to the authenticated profile and ignores a spoofed client agent', async () => {
    const response = await POST(
      request({ description: 'Call after 3 PM', agent: 'Spoofed Agent' }),
      { params: Promise.resolve({ id: 'lead-1' }) },
    )

    expect(response.status).toBe(201)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      lead_id: 'lead-1',
      activity_type: 'note',
      description: 'Call after 3 PM',
      agent: 'Ernest Dodson',
    }))
  })

  it('rejects unauthenticated note creation before writing', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })

    const response = await POST(
      request({ description: 'Call after 3 PM' }),
      { params: Promise.resolve({ id: 'lead-1' }) },
    )

    expect(response.status).toBe(401)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('returns bounded activity history to an authenticated user', async () => {
    const response = await GET(getRequest(), { params: Promise.resolve({ id: 'lead-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.activityLimit).toHaveBeenCalledWith(25)
    expect(body.activities).toHaveLength(1)
  })

  it('rejects unauthenticated activity reads before querying the table', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })

    const response = await GET(getRequest(), { params: Promise.resolve({ id: 'lead-1' }) })

    expect(response.status).toBe(401)
    expect(mocks.activityLimit).not.toHaveBeenCalled()
  })
})
