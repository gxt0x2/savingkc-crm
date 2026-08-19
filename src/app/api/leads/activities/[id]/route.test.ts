import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  syncLeadActivityMutation: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

vi.mock('@/lib/lead-activity-sync', () => ({
  syncLeadActivityMutation: mocks.syncLeadActivityMutation,
}))

import { PATCH } from './route'

describe('lead activity projection sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.syncLeadActivityMutation.mockResolvedValue(true)
    mocks.from.mockImplementation(() => ({
      update: () => ({
        eq: () => ({
          in: () => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'activity-1',
                  activity_type: 'note',
                  description: 'Updated note',
                  agent: 'Agent',
                  metadata: null,
                  created_at: '2026-08-18T12:00:00.000Z',
                },
                error: null,
              }),
            }),
          }),
        }),
      }),
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { lead_id: 'lead-1' }, error: null }),
        }),
      }),
    }))
  })

  it('calls the manifest domain sync directly after an edit', async () => {
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated note' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(200)
    expect(mocks.syncLeadActivityMutation).toHaveBeenCalledWith({
      leadId: 'lead-1',
      activityId: 'activity-1',
      activityType: 'note',
      mutation: 'updated',
    })
  })

  it('reports a projection warning without pretending the activity edit failed', async () => {
    mocks.syncLeadActivityMutation.mockResolvedValue(false)
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated note' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      warning: expect.stringContaining('briefing'),
    })
  })
})
