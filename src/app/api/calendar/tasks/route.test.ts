import { NextRequest } from 'next/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  assertDialerMutationControl: vi.fn(),
  createWorkItem: vi.fn(),
  WorkItemError: class WorkItemError extends Error {
    constructor(message: string, readonly code: string) {
      super(message)
    }
  },
}))

vi.mock('@/lib/api/authenticated-actor', () => ({
  resolveAuthenticatedActor: mocks.resolveAuthenticatedActor,
}))
vi.mock('@/lib/api/dialer-mutation-control', () => ({
  assertDialerMutationControl: mocks.assertDialerMutationControl,
  dialerMutationControlErrorResponse: () => null,
}))
vi.mock('@/lib/server/work-items', () => ({
  createWorkItem: mocks.createWorkItem,
  listWorkItems: vi.fn(),
  normalizeWorkItemKind: (value: unknown) => value === 'offer' ? 'send_offer' : typeof value === 'string' ? value : 'task',
  WorkItemError: mocks.WorkItemError,
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/calendar/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'calendar-test-key-0001' },
    body: JSON.stringify(body),
  })
}

describe('calendar canonical task mutation trust', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.createWorkItem.mockResolvedValue({ created: true, workItem: { key: 'activity:task-1' } })
  })

  it('uses the verified actor and idempotent work-item service', async () => {
    const response = await POST(request({ title: 'Call the seller', actor: 'Ernest' }))

    expect(response.status).toBe(200)
    expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'Casey',
      assignedTo: 'Casey',
      idempotencyKey: 'calendar-test-key-0001',
      title: 'Call the seller',
    }))
    expect(mocks.createWorkItem).not.toHaveBeenCalledWith(expect.objectContaining({ actor: 'Ernest' }))
  })

  it('allows Casey to assign a task to another operating agent', async () => {
    const response = await POST(request({ title: 'Review comps', assignedTo: 'ernest' }))

    expect(response.status).toBe(200)
    expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({ assignedTo: 'Ernest' }))
  })

  it('keeps source Prospect work attached to the prospecting subject', async () => {
    const response = await POST(request({
      title: 'Follow up with source Prospect',
      prospectId: 'prospect-1',
      campaignMemberId: 'member-1',
      dialerSessionId: '10000000-0000-4000-8000-000000000001',
      primaryNextAction: true,
    }))

    expect(response.status).toBe(200)
    expect(mocks.assertDialerMutationControl).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: '10000000-0000-4000-8000-000000000001',
      subject: { leadId: null, prospectId: 'prospect-1', campaignMemberId: 'member-1' },
    }))
    expect(mocks.createWorkItem).toHaveBeenCalledWith(expect.objectContaining({
      leadId: null,
      prospectId: 'prospect-1',
      primaryNextAction: false,
      provenance: expect.objectContaining({
        origin: 'prospecting_wrap_up',
        prospect_id: 'prospect-1',
        campaign_member_id: 'member-1',
      }),
    }))
  })

  it('rejects an unrecognized assignee before canonical mutation', async () => {
    const response = await POST(request({ title: 'Review comps', assignedTo: 'Spoofed Agent' }))

    expect(response.status).toBe(403)
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
  })

  it('denies unauthenticated task creation before canonical mutation', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)

    const response = await POST(request({ title: 'Call the seller' }))

    expect(response.status).toBe(401)
    expect(mocks.createWorkItem).not.toHaveBeenCalled()
  })

  it('returns an actionable conflict when a primary next action already exists', async () => {
    mocks.createWorkItem.mockRejectedValue(new mocks.WorkItemError(
      'This opportunity already has a primary next action. Refresh and edit it instead.',
      'conflict',
    ))

    const response = await POST(request({ title: 'Call seller', primaryNextAction: true }))

    expect(response.status).toBe(409)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: 'This opportunity already has a primary next action. Refresh and edit it instead.',
    })
  })
})
