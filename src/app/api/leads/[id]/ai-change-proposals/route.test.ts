import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveAuthenticatedActor: vi.fn(),
  getAiChangeProposalsForLead: vi.fn(),
  decideAiChangeProposalForLead: vi.fn(),
}))

vi.mock('@/lib/api/authenticated-actor', () => ({ resolveAuthenticatedActor: mocks.resolveAuthenticatedActor }))
vi.mock('@/lib/server/ai-change-proposals', () => ({
  getAiChangeProposalsForLead: mocks.getAiChangeProposalsForLead,
  decideAiChangeProposalForLead: mocks.decideAiChangeProposalForLead,
}))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string) { super(message) }
  },
  isUuid: (value: unknown) => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value),
}))

import { GET, POST } from './route'

const leadId = '00000000-0000-4000-8000-000000000001'
const proposalId = '00000000-0000-4000-8000-000000000002'
const context = { params: Promise.resolve({ id: leadId }) }

function decisionRequest(body: Record<string, unknown>) {
  return new Request(`https://crm.savingkc.com/api/leads/${leadId}/ai-change-proposals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('lead AI change proposal route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolveAuthenticatedActor.mockResolvedValue({ email: 'casey@savingkc.com', name: 'Casey' })
  })

  it('returns only the authenticated lead proposal list', async () => {
    mocks.getAiChangeProposalsForLead.mockResolvedValue([{ id: proposalId, status: 'proposed' }])

    const response = await GET(new Request(`https://crm.savingkc.com/api/leads/${leadId}/ai-change-proposals`), context)

    expect(response.status).toBe(200)
    expect(mocks.getAiChangeProposalsForLead).toHaveBeenCalledWith(leadId)
    expect(await response.json()).toEqual({ proposals: [{ id: proposalId, status: 'proposed' }] })
  })

  it('ignores spoofed actors and attributes a decision to the authenticated user', async () => {
    mocks.decideAiChangeProposalForLead.mockResolvedValue({ id: proposalId, status: 'applied' })

    const response = await POST(decisionRequest({
      proposalId,
      decision: 'approved',
      decisionKey: `lead-ai:${proposalId}:approved`,
      decidedBy: 'spoofed@savingkc.com',
    }), context)

    expect(response.status).toBe(200)
    expect(mocks.decideAiChangeProposalForLead).toHaveBeenCalledWith({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      leadId,
      proposalId,
      decision: 'approved',
      decisionKey: `lead-ai:${proposalId}:approved`,
      note: null,
    })
  })

  it('rejects unauthenticated decisions before parsing the body', async () => {
    mocks.resolveAuthenticatedActor.mockResolvedValue(null)
    const request = decisionRequest({ proposalId, decision: 'approved', decisionKey: 'valid-key' })
    const parse = vi.spyOn(request, 'json')

    const response = await POST(request, context)

    expect(response.status).toBe(401)
    expect(parse).not.toHaveBeenCalled()
    expect(mocks.decideAiChangeProposalForLead).not.toHaveBeenCalled()
  })
})
