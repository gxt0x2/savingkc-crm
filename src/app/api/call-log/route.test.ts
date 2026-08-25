import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

const mocks = vi.hoisted(() => ({
  actor: vi.fn(),
  context: vi.fn(),
  evidence: vi.fn(),
  advance: vi.fn(),
  CallLogContextError: class CallLogContextError extends Error {
    constructor(message: string, readonly status = 409) {
      super(message)
    }
  },
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.actor }))
vi.mock('@/lib/server/call-log-context', () => ({
  resolveCallLogContext: mocks.context,
  CallLogContextError: mocks.CallLogContextError,
}))
vi.mock('@/lib/server/call-log-evidence', () => ({ insertCallLogEvidenceOnce: mocks.evidence }))
vi.mock('@/lib/telephony/agent-identity', () => ({
  resolveAgentTelephonyProfile: () => ({ identity: 'agent:casey' }),
}))
vi.mock('@/lib/pipeline-auto-advance', () => ({ checkAutoAdvance: mocks.advance }))
vi.mock('@/lib/supabase-lazy', () => ({
  supabase: {
    from() {
      return {
        update() { return { eq() { return Promise.resolve({ error: null }) } } },
      }
    },
  },
}))

import { GET, POST } from './route'

function request(body: Record<string, unknown>) {
  return new NextRequest('https://crm.savingkc.com/api/call-log', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('call log trust boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.actor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
    mocks.context.mockResolvedValue({ leadId: 'lead-1', leadName: 'Seller', heir: null })
    mocks.evidence.mockResolvedValue({ id: 'activity-1', created: true })
    mocks.advance.mockResolvedValue(undefined)
  })

  it('rejects anonymous writes before parsing or evidence access', async () => {
    mocks.actor.mockResolvedValue(null)
    const req = request({ phone: '8165550100', event: 'started' })
    const parse = vi.spyOn(req, 'json')

    const response = await POST(req)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.context).not.toHaveBeenCalled()
    expect(mocks.evidence).not.toHaveBeenCalled()
  })

  it('stores server-attributed internal telemetry with the durable attempt', async () => {
    const response = await POST(request({
      phone: '8165550100',
      event: 'ended',
      lead_id: 'lead-1',
      clientAttemptId: 'attempt-1',
      status: 'no-answer',
      agent: 'Spoofed Agent',
      agent_identity: 'agent:spoofed',
    }))

    expect(response.status).toBe(200)
    expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 'lead-1',
      event: 'call_ended',
      clientAttemptId: 'attempt-1',
      payload: expect.objectContaining({
        agent: 'Casey',
        metadata: expect.objectContaining({
          agent_identity: 'agent:casey',
          is_internal: true,
          client_attempt_id: 'attempt-1',
        }),
      }),
    }))
  })

  it('preserves a manual-dial final outcome without inventing a contact link', async () => {
    mocks.context.mockResolvedValue({ leadId: null, leadName: '+18165550100', heir: null })
    const response = await POST(request({
      to_number: '8165550100',
      status: 'completed',
      disposition: 'no_answer',
      clientAttemptId: 'attempt-manual',
    }))

    expect(response.status).toBe(200)
    expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({
      leadId: null,
      event: 'call_ended',
    }))
  })

  it('stores manual wrap-up as a final disposition event instead of deduping it against call end', async () => {
    mocks.context.mockResolvedValue({ leadId: null, leadName: '+18165550100', heir: null })
    const response = await POST(request({
      to_number: '8165550100',
      event: 'dispositioned',
      status: 'completed',
      disposition: 'no_answer',
      clientAttemptId: 'attempt-manual-final',
    }))

    expect(response.status).toBe(200)
    expect(mocks.evidence).toHaveBeenCalledWith(expect.objectContaining({
      leadId: null,
      event: 'call_disposition',
      clientAttemptId: 'attempt-manual-final',
      payload: expect.objectContaining({
        metadata: expect.objectContaining({ action: 'call_disposition', disposition: 'no_answer' }),
      }),
    }))
  })

  it('returns a context conflict without writing evidence', async () => {
    mocks.context.mockRejectedValue(new mocks.CallLogContextError('Call context mismatch'))

    const response = await POST(request({ phone: '8165550100', event: 'started', lead_id: 'lead-1' }))

    expect(response.status).toBe(409)
    expect(mocks.evidence).not.toHaveBeenCalled()
  })

  it('requires authentication for recent-call reads before querying CRM data', async () => {
    mocks.actor.mockResolvedValue(null)
    const response = await GET(new NextRequest('https://crm.savingkc.com/api/call-log'))
    expect(response.status).toBe(401)
  })
})
