import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  getClaims: vi.fn(),
  profileMaybeSingle: vi.fn(),
  insert: vi.fn(),
  activityLimit: vi.fn(),
  activityTypeEq: vi.fn(),
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

function getRequest(query = 'limit=25') {
  return new NextRequest(`https://crm.savingkc.com/api/leads/lead-1/activities?${query}`)
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
      const activityQuery = {
        eq: (field: string, value: string) => {
          if (field === 'activity_type') mocks.activityTypeEq(value)
          return activityQuery
        },
        order: () => ({ limit: mocks.activityLimit }),
      }
      return {
        select: () => activityQuery,
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

  it('records allowlisted contract and mail commands with the authenticated actor', async () => {
    const contractResponse = await POST(
      request({
        kind: 'contract_terms',
        propertyAddress: '123 Main St',
        purchasePrice: 125000,
        closingDate: '2026-09-30',
        agent: 'Spoofed Agent',
      }),
      { params: Promise.resolve({ id: 'lead-1' }) },
    )
    const mailResponse = await POST(
      request({
        kind: 'mail_piece',
        pieceType: 'postcard',
        sentDate: '2026-08-23',
      }),
      { params: Promise.resolve({ id: 'lead-1' }) },
    )

    expect(contractResponse.status).toBe(201)
    expect(mailResponse.status).toBe(201)
    expect(mocks.insert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      activity_type: 'contract_sent',
      agent: 'Ernest Dodson',
    }))
    expect(mocks.insert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      activity_type: 'letter_tracking',
      agent: 'Ernest Dodson',
    }))
  })

  it('rejects unsupported activity commands before writing', async () => {
    const response = await POST(
      request({ kind: 'delete_all' }),
      { params: Promise.resolve({ id: 'lead-1' }) },
    )

    expect(response.status).toBe(400)
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('commits the canonical activity without a legacy projection warning', async () => {
    const response = await POST(request({ description: 'Persist this note' }), { params: Promise.resolve({ id: 'lead-1' }) })
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.activity).toBeTruthy()
    expect(body.warning).toBeUndefined()
  })

  it('returns bounded activity history to an authenticated user', async () => {
    const response = await GET(getRequest('type=letter_tracking&limit=10'), { params: Promise.resolve({ id: 'lead-1' }) })
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mocks.activityTypeEq).toHaveBeenCalledWith('letter_tracking')
    expect(mocks.activityLimit).toHaveBeenCalledWith(10)
    expect(body.activities).toHaveLength(1)
  })

  it('rejects unauthenticated activity reads before querying the table', async () => {
    mocks.getClaims.mockResolvedValue({ data: { claims: {} }, error: null })

    const response = await GET(getRequest(), { params: Promise.resolve({ id: 'lead-1' }) })

    expect(response.status).toBe(401)
    expect(mocks.activityLimit).not.toHaveBeenCalled()
  })
})
