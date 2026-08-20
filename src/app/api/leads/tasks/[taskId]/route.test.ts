import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  from: vi.fn(),
  update: vi.fn(),
  maybeSingle: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))

vi.mock('@/lib/supabase-lazy', () => ({
  supabase: { from: mocks.from },
}))

import { PATCH } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/leads/tasks/task-1', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const context = { params: Promise.resolve({ taskId: 'task-1' }) }

describe('lead task mutation trust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.maybeSingle.mockResolvedValue({
      data: {
        id: 'task-1',
        activity_type: 'task',
        description: 'Call the seller',
        metadata: { assigned_to: 'Ernest', status: 'pending' },
      },
      error: null,
    })
    mocks.from.mockImplementation(() => ({
      select: () => ({
        eq: () => ({ maybeSingle: mocks.maybeSingle }),
      }),
      update: (payload: unknown) => {
        mocks.update(payload)
        return { eq: async () => ({ error: null }) }
      },
    }))
  })

  it('attributes a status mutation to Casey and ignores a spoofed actor', async () => {
    const response = await PATCH(request({ status: 'completed', actor: 'Ernest' }), context)

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({
        assigned_to: 'Ernest',
        status: 'completed',
        updated_by: 'Casey',
      }),
    }))
    const update = mocks.update.mock.calls[0]?.[0] as { metadata?: Record<string, unknown> }
    expect(update.metadata).not.toHaveProperty('actor')
    expect(update.metadata).not.toHaveProperty('userEdited')
  })

  it('defaults an ownerless task to Casey', async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { id: 'task-1', activity_type: 'task', description: 'Call the seller', metadata: {} },
      error: null,
    })

    const response = await PATCH(request({ status: 'completed' }), context)

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ assigned_to: 'Casey', updated_by: 'Casey' }),
    }))
  })

  it('allows Casey to explicitly assign another operating agent', async () => {
    const response = await PATCH(request({ assignedTo: 'gertha' }), context)

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      metadata: expect.objectContaining({ assigned_to: 'Gertha', updated_by: 'Casey' }),
    }))
  })

  it('rejects an unrecognized assignee without updating the task', async () => {
    const response = await PATCH(request({ assignedTo: 'Spoofed Agent' }), context)

    expect(response.status).toBe(403)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('denies a request without a user session', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await PATCH(request({ status: 'completed' }), context)

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
