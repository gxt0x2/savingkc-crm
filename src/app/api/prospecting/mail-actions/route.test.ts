import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  assertControl: vi.fn(),
  create: vi.fn(),
  transition: vi.fn(),
  WorkItemError: class WorkItemError extends Error {
    constructor(message: string, readonly code: string) { super(message) }
  },
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/api/dialer-mutation-control', () => ({
  assertDialerMutationControl: mocks.assertControl,
  dialerMutationControlErrorResponse: () => null,
}))
vi.mock('@/lib/server/work-items', () => ({
  createWorkItem: mocks.create,
  transitionWorkItem: mocks.transition,
  WorkItemError: mocks.WorkItemError,
}))

import { POST } from './route'

function request(body: Record<string, unknown>) {
  return new Request('https://crm.savingkc.com/api/prospecting/mail-actions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'mail-action-test-0001' },
    body: JSON.stringify(body),
  })
}

const workItem = { key: 'activity:mail-1', version: 1, status: 'pending' }

describe('POST /api/prospecting/mail-actions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.create.mockResolvedValue({ created: true, workItem })
    mocks.transition.mockResolvedValue({ changed: true, workItem: { ...workItem, version: 2, status: 'completed' } })
  })

  it('creates canonical mail work for an unpromoted source Prospect', async () => {
    const response = await POST(request({
      prospectId: 'prospect-1',
      campaignMemberId: 'member-1',
      sellerName: 'Mojo Contact',
      propertyAddress: '123 Main St',
      pieceType: 'thank_you',
      mailState: 'needed',
      dueAt: '2026-09-04T14:00:00.000Z',
    }))

    expect(response.status).toBe(201)
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      actor: 'Casey',
      leadId: null,
      prospectId: 'prospect-1',
      kind: 'mail',
      title: 'Thank-you letter for Mojo Contact',
      idempotencyKey: 'mail-action-test-0001',
      provenance: expect.objectContaining({ origin: 'prospecting_wrap_up', mail_piece_type: 'thank_you' }),
    }))
    expect(mocks.transition).not.toHaveBeenCalled()
  })

  it('records already-sent mail as completed using the same canonical item', async () => {
    const response = await POST(request({
      leadId: 'lead-1',
      pieceType: 'postcard',
      mailState: 'sent',
      sellerName: 'Seller One',
    }))

    expect(response.status).toBe(201)
    expect(mocks.transition).toHaveBeenCalledWith(expect.objectContaining({
      key: 'activity:mail-1',
      action: 'complete',
      expectedVersion: 1,
      idempotencyKey: 'mail-action-test-0001:sent',
    }))
  })

  it('rejects mail without a durable CRM subject', async () => {
    const response = await POST(request({ pieceType: 'letter', mailState: 'needed' }))

    expect(response.status).toBe(400)
    expect(mocks.create).not.toHaveBeenCalled()
  })
})
