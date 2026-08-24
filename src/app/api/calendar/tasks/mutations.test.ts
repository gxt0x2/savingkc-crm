import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  transitionWorkItem: vi.fn(),
  transitionWorkItemsBulk: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))
vi.mock('@/lib/server/work-items', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/work-items')>()
  return {
    ...actual,
    transitionWorkItem: mocks.transitionWorkItem,
    transitionWorkItemsBulk: mocks.transitionWorkItemsBulk,
  }
})

import { DELETE, PATCH } from './[id]/route'
import { POST as BULK_POST } from './bulk/route'

function request(path: string, method: string, body?: Record<string, unknown>) {
  return new NextRequest(`https://crm.savingkc.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'calendar-test-key-0001' },
    body: body ? JSON.stringify(body) : undefined,
  })
}

const task = { key: 'activity:task-1', version: 2 }
const context = { params: Promise.resolve({ id: task.key }) }

describe('calendar work-item mutations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.transitionWorkItem.mockResolvedValue({ changed: true, workItem: task })
    mocks.transitionWorkItemsBulk.mockResolvedValue({ changed: 2, workItems: [task, task] })
  })

  it('edits through the audited version-aware transition', async () => {
    const response = await PATCH(request('/api/calendar/tasks/activity:task-1', 'PATCH', {
      title: 'Call after lunch', assignedTo: 'Ernest', expectedVersion: 1,
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.transitionWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'Casey',
      action: 'edit',
      expectedVersion: 1,
      patch: expect.objectContaining({ title: 'Call after lunch', assignedTo: 'Ernest' }),
    }))
  })

  it('allows an intentional single-task unassignment', async () => {
    const response = await PATCH(request('/api/calendar/tasks/activity:task-1', 'PATCH', {
      assignedTo: null,
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.transitionWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      action: 'edit',
      patch: { assignedTo: null },
    }))
  })

  it('cancels instead of hard-deleting the durable source row', async () => {
    const response = await DELETE(request('/api/calendar/tasks/activity:task-1', 'DELETE'), context)

    expect(response.status).toBe(200)
    expect(mocks.transitionWorkItem).toHaveBeenCalledWith(expect.objectContaining({ action: 'cancel' }))
  })

  it('uses one transactional RPC for bulk completion', async () => {
    const response = await BULK_POST(request('/api/calendar/tasks/bulk', 'POST', {
      ids: ['activity:task-1', 'activity:task-2'], action: 'complete',
    }))

    expect(response.status).toBe(200)
    expect(mocks.transitionWorkItemsBulk).toHaveBeenCalledTimes(1)
    expect(mocks.transitionWorkItemsBulk).toHaveBeenCalledWith(expect.objectContaining({
      action: 'complete',
      actor: 'Casey',
    }))
  })

  it('uses the canonical cancel transition for bulk cancellation', async () => {
    const response = await BULK_POST(request('/api/calendar/tasks/bulk', 'POST', {
      ids: ['activity:task-1', 'activity:task-2'], action: 'cancel',
    }))

    expect(response.status).toBe(200)
    expect(mocks.transitionWorkItemsBulk).toHaveBeenCalledWith(expect.objectContaining({
      action: 'cancel',
      actor: 'Casey',
    }))
  })

  it('rejects the retired delete alias', async () => {
    const response = await BULK_POST(request('/api/calendar/tasks/bulk', 'POST', {
      ids: ['activity:task-1'], action: 'delete',
    }))

    expect(response.status).toBe(400)
    expect(mocks.transitionWorkItemsBulk).not.toHaveBeenCalled()
  })

  it('rejects spoofed bulk assignees before mutation', async () => {
    const response = await BULK_POST(request('/api/calendar/tasks/bulk', 'POST', {
      ids: ['activity:task-1'], action: 'assign', assignedTo: 'Spoofed Agent',
    }))

    expect(response.status).toBe(403)
    expect(mocks.transitionWorkItemsBulk).not.toHaveBeenCalled()
  })

  it('allows an intentional bulk unassignment', async () => {
    const response = await BULK_POST(request('/api/calendar/tasks/bulk', 'POST', {
      ids: ['activity:task-1'], action: 'assign', assignedTo: null,
    }))

    expect(response.status).toBe(200)
    expect(mocks.transitionWorkItemsBulk).toHaveBeenCalledWith(expect.objectContaining({
      action: 'edit',
      patch: { assignedTo: null },
    }))
  })
})
