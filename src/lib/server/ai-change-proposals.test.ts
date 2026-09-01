import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  rpc: vi.fn(),
  getDialerSession: vi.fn(),
  getDialerSessionControlSummary: vi.fn(),
}))

vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from, rpc: mocks.rpc } }))
vi.mock('@/lib/server/dialer-session-engine', () => ({
  DialerSessionError: class DialerSessionError extends Error {
    constructor(public code: string, public status: number, message: string, public details?: unknown) { super(message) }
  },
  getDialerSession: mocks.getDialerSession,
  getDialerSessionControlSummary: mocks.getDialerSessionControlSummary,
}))

import { createCallAnalysisLeadProposal, decideAiChangeProposal } from './ai-change-proposals'
import { MOJO_CALL_ANALYZER_MODEL } from '@/lib/mojo-call-analyzer'

function chain(result: { data: unknown; error: unknown }) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {
    select: vi.fn(),
    eq: vi.fn(),
    in: vi.fn(),
    insert: vi.fn(),
    maybeSingle: vi.fn(async () => result),
  }
  builder.select.mockReturnValue(builder)
  builder.eq.mockReturnValue(builder)
  builder.in.mockReturnValue(builder)
  builder.insert.mockReturnValue(builder)
  return builder
}

const proposalRow = {
  id: 'proposal-1',
  status: 'proposed',
  summary: 'Seller wants to move this fall.',
  proposed_changes: { motivation_score: 8, classification: 'opportunity' },
  base_snapshot: { motivation_score: 4, classification: 'lead' },
  decided_by: null,
  decision_note: null,
  decided_at: null,
  applied_at: null,
  error_code: null,
}

describe('server AI change proposals', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getDialerSession.mockResolvedValue({ id: 'session-1' })
  })

  it('creates a bounded proposal instead of mutating the lead from model output', async () => {
    const attempt = chain({ data: { id: 'attempt-row-1', lead_id: 'lead-1' }, error: null })
    const lead = chain({ data: {
      motivation_score: 4,
      property_condition: 'fair',
      asking_price: 120000,
      opportunity_score: 40,
      classification: 'lead',
      station: 'contacted',
    }, error: null })
    const proposals = chain({ data: proposalRow, error: null })
    mocks.from.mockImplementation((table: string) => table === 'dialer_session_attempts' ? attempt : table === 'leads' ? lead : proposals)

    const result = await createCallAnalysisLeadProposal({
      leadId: 'lead-1',
      clientAttemptId: 'attempt-1',
      recordingSid: 'RE123',
      analysis: {
        aiSummary: 'Seller wants to move this fall.',
        motivationScore: 8,
        classification: 'opportunity',
        appointmentDateTime: '2026-09-01T15:00:00Z',
        coOwners: ['Pat Seller'],
      },
    })

    expect(result).toMatchObject({ id: 'proposal-1', status: 'proposed' })
    const inserted = proposals.insert.mock.calls[0]?.[0]
    expect(inserted).toMatchObject({
      entity_id: 'lead-1',
      source_type: 'call_analysis',
      provider: 'groq',
      model: MOJO_CALL_ANALYZER_MODEL,
      proposed_changes: { motivation_score: 8, classification: 'opportunity' },
      base_snapshot: { motivation_score: 4, classification: 'lead' },
    })
    expect(JSON.stringify(inserted)).not.toContain('appointmentDateTime')
    expect(JSON.stringify(inserted)).not.toContain('Pat Seller')
    expect(lead.insert).not.toHaveBeenCalled()
  })

  it('verifies session ownership before invoking the atomic decision function', async () => {
    const attempt = chain({ data: { id: 'attempt-row-1' }, error: null })
    const proposals = chain({ data: proposalRow, error: null })
    mocks.from.mockImplementation((table: string) => table === 'dialer_session_attempts' ? attempt : proposals)
    mocks.rpc.mockResolvedValue({ data: { ...proposalRow, status: 'applied', decided_by: 'casey@savingkc.com' }, error: null })

    const result = await decideAiChangeProposal({
      actor: { email: 'casey@savingkc.com', name: 'Casey' },
      sessionId: 'session-1',
      clientAttemptId: 'attempt-1',
      controllerToken: '10000000-0000-4000-8000-000000000001',
      decision: 'approved',
      decisionKey: 'dialer-ai:proposal-1:approved',
    })

    expect(mocks.rpc).toHaveBeenCalledWith('decide_dialer_ai_change_proposal_v2', expect.objectContaining({
      p_session_id: 'session-1',
      p_controller_token: '10000000-0000-4000-8000-000000000001',
      p_decision: 'approved',
      p_decided_by: 'casey@savingkc.com',
    }))
    expect(result).toMatchObject({ status: 'applied', decidedBy: 'casey@savingkc.com' })
  })

  it('creates a lead-level proposal for inbound recordings without a dialer attempt', async () => {
    const lead = chain({ data: {
      station: 'contacted',
      motivation_score: null,
      property_condition: null,
      asking_price: null,
      opportunity_score: null,
      classification: null,
    }, error: null })
    const proposals = chain({ data: { ...proposalRow, proposed_changes: { motivation_score: 7 }, base_snapshot: { motivation_score: null } }, error: null })
    mocks.from.mockImplementation((table: string) => table === 'leads' ? lead : proposals)

    await createCallAnalysisLeadProposal({
      leadId: 'lead-1',
      clientAttemptId: null,
      recordingSid: 'RE-inbound',
      analysis: { motivationScore: 7 },
    })

    expect(mocks.from).not.toHaveBeenCalledWith('dialer_session_attempts')
    expect(proposals.insert).toHaveBeenCalledWith(expect.objectContaining({
      dialer_session_attempt_id: null,
      proposed_changes: { motivation_score: 7 },
    }))
  })

  it('fails without querying records when the atomic decision reports lost control', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'session_control_lost' } })
    mocks.getDialerSessionControlSummary.mockResolvedValue({ sessionId: 'casey-session', generation: 2 })

    await expect(decideAiChangeProposal({
      actor: { email: 'ernest@savingkc.com', name: 'Ernest' },
      sessionId: 'casey-session',
      clientAttemptId: 'attempt-1',
      controllerToken: '10000000-0000-4000-8000-000000000001',
      decision: 'rejected',
      decisionKey: 'dialer-ai:proposal-1:rejected',
    })).rejects.toMatchObject({ code: 'session_control_lost', details: { sessionId: 'casey-session' } })
    expect(mocks.from).not.toHaveBeenCalled()
    expect(mocks.rpc).toHaveBeenCalledWith('decide_dialer_ai_change_proposal_v2', expect.any(Object))
  })
})
