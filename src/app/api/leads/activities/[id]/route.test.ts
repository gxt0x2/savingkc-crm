import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  deleteRow: vi.fn(),
  resolveAuthenticatedActor: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { DELETE, PATCH } from './route'

describe('canonical lead activity mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.from.mockImplementation(() => ({
      update: (payload: unknown) => {
        mocks.update(payload)
        return {
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
        }
      },
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { lead_id: 'lead-1', activity_type: 'note' }, error: null }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          in: async () => {
            mocks.deleteRow()
            return { error: null }
          },
        }),
      }),
    }))
  })

  it('edits the canonical activity without a legacy projection write', async () => {
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated note' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith({ description: 'Updated note' })
    expect(mocks.from).toHaveBeenCalledTimes(1)
  })

  it('returns the committed canonical activity with no projection warning', async () => {
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Updated note' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      activity: expect.objectContaining({ id: 'activity-1' }),
    })
  })

  it('redirects task-shaped edits to the canonical work-item service', async () => {
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: 'Review the offer',
        activity_type: 'task',
        actor: 'Spoofed Agent',
        metadata: {
          assigned_to: 'ernest',
          status: 'pending',
          actor: 'Spoofed Agent',
          created_by: 'Spoofed Agent',
          updated_by: 'Spoofed Agent',
        },
      }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      replacement: '/api/calendar/tasks/activity-1',
    })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('denies unauthenticated task edits before reading activity data', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: 'Review the offer' }),
    })

    const response = await PATCH(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })

  it('redirects task-shaped deletes to the canonical work-item service', async () => {
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({
          single: async () => ({ data: { lead_id: 'lead-1', activity_type: 'task' }, error: null }),
        }),
      }),
      delete: () => ({
        eq: () => ({
          in: async () => {
            mocks.deleteRow()
            return { error: null }
          },
        }),
      }),
    }))
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toMatchObject({
      replacement: '/api/calendar/tasks/activity-1',
    })
    expect(mocks.deleteRow).not.toHaveBeenCalled()
  })

  it('denies unauthenticated activity deletes before reading activity data', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const request = new NextRequest('https://crm.savingkc.com/api/leads/activities/activity-1', {
      method: 'DELETE',
    })

    const response = await DELETE(request, { params: Promise.resolve({ id: 'activity-1' }) })

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
