import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  assertOperation: vi.fn(),
  getSession: vi.fn(),
  getOpenSession: vi.fn(),
}))

vi.mock('@/lib/server/dialer-session-engine', () => {
  class DialerSessionError extends Error {
    constructor(
      public readonly code: string,
      public readonly status: number,
      message: string,
      public readonly details?: unknown,
    ) {
      super(message)
    }
  }
  return {
    assertDialerSessionControlOperation: mocks.assertOperation,
    DialerSessionError,
    getDialerSession: mocks.getSession,
    getOpenDialerSession: mocks.getOpenSession,
  }
})

import {
  assertDialerMutationControl,
  dialerMutationControlErrorResponse,
} from './dialer-mutation-control'

const sessionId = '11111111-1111-4111-8111-111111111111'
const controllerToken = '22222222-2222-4222-8222-222222222222'
const operationId = '33333333-3333-4333-8333-333333333333'
const actor = { email: 'casey@savingkc.com', name: 'Casey' }

function session(overrides: Record<string, unknown> = {}) {
  return {
    id: sessionId,
    status: 'active',
    currentSubjectKind: 'lead',
    currentSubjectId: 'lead-1',
    currentCampaignMemberId: 'member-1',
    ...overrides,
  }
}

function request(headers: Record<string, string> = {}) {
  return new Request('https://crm.savingkc.com/api/example', { headers })
}

describe('dialer mutation control boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getSession.mockResolvedValue(session())
    mocks.getOpenSession.mockResolvedValue(null)
    mocks.assertOperation.mockResolvedValue(undefined)
  })

  it('asserts the controller operation after matching the current session subject', async () => {
    await expect(assertDialerMutationControl({
      request: request({
        'X-Dialer-Controller': controllerToken,
        'X-Dialer-Operation': operationId,
      }),
      actor,
      sessionId,
      subject: { leadId: 'lead-1', campaignMemberId: 'member-1' },
    })).resolves.toMatchObject({ id: sessionId })

    expect(mocks.assertOperation).toHaveBeenCalledWith({
      actor,
      sessionId,
      controllerToken,
      operationId,
    })
  })

  it('rejects explicit dialer context without an operation lease', async () => {
    await expect(assertDialerMutationControl({
      request: request({ 'X-Dialer-Controller': controllerToken }),
      actor,
      sessionId,
      subject: { leadId: 'lead-1' },
    })).rejects.toMatchObject({ code: 'dialer_operation_required', status: 409 })
    expect(mocks.getSession).not.toHaveBeenCalled()
    expect(mocks.assertOperation).not.toHaveBeenCalled()
  })

  it('rejects a session whose current subject differs from the mutation', async () => {
    await expect(assertDialerMutationControl({
      request: request({
        'X-Dialer-Controller': controllerToken,
        'X-Dialer-Operation': operationId,
      }),
      actor,
      sessionId,
      subject: { leadId: 'lead-2' },
    })).rejects.toMatchObject({ code: 'session_context_mismatch', status: 409 })
    expect(mocks.assertOperation).not.toHaveBeenCalled()
  })

  it('rejects explicit session authority without a record subject', async () => {
    mocks.getSession.mockResolvedValue(session({ currentCampaignMemberId: null }))
    await expect(assertDialerMutationControl({
      request: request({
        'X-Dialer-Controller': controllerToken,
        'X-Dialer-Operation': operationId,
      }),
      actor,
      sessionId,
      subject: {},
    })).rejects.toMatchObject({ code: 'session_context_mismatch', status: 409 })
    expect(mocks.assertOperation).not.toHaveBeenCalled()
  })

  it('blocks a stale client when the actor has the same record open in Prospecting', async () => {
    mocks.getOpenSession.mockResolvedValue(session())
    let error: unknown
    try {
      await assertDialerMutationControl({
        request: request(),
        actor,
        sessionId: null,
        subject: { leadId: 'lead-1' },
        protectMatchingOpenSession: true,
      })
    } catch (caught) {
      error = caught
    }

    const response = dialerMutationControlErrorResponse(error)
    expect(response?.status).toBe(409)
    await expect(response?.json()).resolves.toMatchObject({ code: 'dialer_session_control_required' })
  })

  it('fails closed for a pre-deploy Prospecting page even when no open-session lookup can identify it', async () => {
    await expect(assertDialerMutationControl({
      request: request({ referer: 'https://crm.savingkc.com/prospecting/calling' }),
      actor,
      sessionId: null,
      subject: { leadId: 'lead-1' },
      protectMatchingOpenSession: true,
    })).rejects.toMatchObject({ code: 'dialer_session_control_required', status: 409 })
    expect(mocks.getOpenSession).not.toHaveBeenCalled()
  })

  it('leaves unrelated CRM page mutations unaffected', async () => {
    mocks.getOpenSession.mockResolvedValue(session())
    await expect(assertDialerMutationControl({
      request: request(),
      actor,
      sessionId: null,
      subject: { leadId: 'another-lead' },
      protectMatchingOpenSession: true,
    })).resolves.toBeNull()
    expect(mocks.assertOperation).not.toHaveBeenCalled()
  })

  it('always requires session authority for an explicitly dialer-only action', async () => {
    await expect(assertDialerMutationControl({
      request: request(),
      actor,
      sessionId: null,
      subject: { leadId: 'lead-1' },
      required: true,
    })).rejects.toMatchObject({ code: 'dialer_session_control_required', status: 409 })
    expect(mocks.getOpenSession).not.toHaveBeenCalled()
  })
})
