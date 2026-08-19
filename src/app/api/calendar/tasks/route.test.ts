import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  from: vi.fn(),
  insert: vi.fn(),
  single: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: mocks.from }),
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/calendar/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('calendar task mutation trust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.single.mockResolvedValue({ data: { id: 'task-1' }, error: null })
    mocks.from.mockImplementation(() => ({
      insert: (payload: unknown) => {
        mocks.insert(payload)
        return { select: () => ({ single: mocks.single }) }
      },
    }))
  })

  it('defaults ownership to Casey while ignoring a spoofed actor', async () => {
    const response = await POST(request({ title: 'Call the seller', actor: 'Ernest' }))

    expect(response.status).toBe(200)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      activity_type: 'task',
      agent: 'Casey',
      metadata: expect.objectContaining({
        assigned_to: 'Casey',
      }),
    }))
    expect(mocks.insert).not.toHaveBeenCalledWith(expect.objectContaining({ actor: expect.anything() }))
  })

  it('allows Casey to explicitly assign a task to another operating agent', async () => {
    const response = await POST(request({ title: 'Review comps', assignedTo: 'ernest' }))

    expect(response.status).toBe(200)
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({
      agent: 'Ernest',
      metadata: expect.objectContaining({ assigned_to: 'Ernest' }),
    }))
  })

  it('rejects an unrecognized assignee before writing', async () => {
    const response = await POST(request({ title: 'Review comps', assignedTo: 'Spoofed Agent' }))

    expect(response.status).toBe(403)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })

  it('denies unauthenticated task creation before writing', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await POST(request({ title: 'Call the seller' }))

    expect(response.status).toBe(401)
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.insert).not.toHaveBeenCalled()
  })
})
