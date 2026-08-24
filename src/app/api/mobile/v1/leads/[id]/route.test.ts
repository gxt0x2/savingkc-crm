import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({ requireMobileUser: vi.fn(), admin: vi.fn(), listWorkItems: vi.fn() }))
vi.mock('@/lib/mobile-api/auth', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/mobile-api/auth')>(), requireMobileUser: mocks.requireMobileUser,
}))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: mocks.admin }))
vi.mock('@/lib/server/work-items', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/lib/server/work-items')>(), listWorkItems: mocks.listWorkItems,
}))

import { GET } from './route'

const context = { params: Promise.resolve({ id: 'lead-1' }) }

function database() {
  return {
    from(table: string) {
      if (table === 'leads') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { id: 'lead-1', station: 'under_contract', assigned_agent: 'Casey' }, error: null,
        }) }) }) }
      }
      if (table === 'lead_activities') {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }) }) }
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: 'handoff-1' }], error: null }) }) }),
          }),
        }),
      }
    },
  }
}

describe('mobile lead operations detail', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireMobileUser.mockResolvedValue({ user: { email: 'casey@savingkc.com' } })
    mocks.admin.mockReturnValue(database())
    mocks.listWorkItems.mockResolvedValue([{ key: 'activity:task-1', primaryNextAction: true }])
  })

  it('returns canonical owner, department, next action, and pending handoff state', async () => {
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      operations: {
        department: 'dispositions',
        owner: 'Casey',
        primaryNextAction: { key: 'activity:task-1' },
        tasksAvailable: true,
        pendingHandoffs: [{ id: 'handoff-1' }],
        handoffsAvailable: true,
      },
    })
  })

  it('marks task state unavailable instead of presenting a misleading empty queue', async () => {
    mocks.listWorkItems.mockRejectedValue(new Error('not installed'))
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/mobile/v1/leads/lead-1', {
      headers: { Authorization: 'Bearer token' },
    }), context)

    await expect(response.json()).resolves.toMatchObject({
      operations: { primaryNextAction: null, tasksAvailable: false },
    })
  })
})
