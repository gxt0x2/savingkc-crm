import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({ rpc: mocks.rpc }) }))

import {
  acceptDepartmentHandoff,
  finalizeFundedClose,
  finalizeVerifiedFallout,
  recordAssignmentToTcHandoff,
  recordVerifiedMarketingOutcome,
} from './crm-operating-handoffs'

describe('seller-to-close operating handoffs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('records assignment evidence against the existing buyer offer and TC file', async () => {
    mocks.rpc.mockResolvedValue({ data: { handoffId: 'handoff-1', status: 'accepted', replayed: false }, error: null })
    await recordAssignmentToTcHandoff({
      commandId: '11111111-1111-4111-8111-111111111111',
      leadId: 'lead-1', buyerOfferId: 'offer-1', tcFileId: 'file-1',
      evidenceReference: 'submission-1', actorEmail: 'docuseal@savingkc.system', actorName: 'DocuSeal',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('crm_record_department_handoff_v1', expect.objectContaining({
      target_from_department: 'dispositions',
      target_to_department: 'transaction_coordination',
      target_source_record_type: 'buyer_offer',
      target_source_record_id: 'offer-1',
      target_record_type: 'tc_file',
      target_record_id: 'file-1',
      target_evidence_type: 'assignment_signed',
    }))
  })

  it('returns verified revenue to Marketing from funded closeout evidence', async () => {
    mocks.rpc.mockResolvedValue({ data: { outcomeId: 'outcome-1', outcome: 'closed_won', revenue: 25000 }, error: null })
    await recordVerifiedMarketingOutcome({
      outcomeKey: 'funded:deal-1', leadId: 'lead-1', outcome: 'closed_won', revenue: 25000,
      occurredAt: '2026-08-23T17:00:00.000Z', evidenceType: 'funded_closeout', evidenceId: 'deal-1', actorName: 'Casey',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('crm_record_marketing_outcome_v1', expect.objectContaining({
      target_outcome_key: 'funded:deal-1', target_outcome: 'closed_won',
      target_revenue: 25000, target_evidence_type: 'funded_closeout',
    }))
  })

  it('finalizes the deal, canonical lifecycle, TC file, and Marketing outcome atomically', async () => {
    mocks.rpc.mockResolvedValue({ data: { deal: { id: 'deal-1' }, lifecycle: {}, marketingOutcome: {} }, error: null })
    await finalizeFundedClose({
      dealId: 'deal-1', closeout: { version: 1 }, fundedAt: '2026-08-23T17:00:00.000Z',
      assignmentFee: 25000, closeDate: '2026-08-23', debriefDueAt: '2026-08-24T17:00:00.000Z',
      actorEmail: 'casey@savingkc.com', actorName: 'Casey', netRevenue: 24000,
    })
    expect(mocks.rpc).toHaveBeenCalledWith('crm_finalize_funded_close_v1', expect.objectContaining({
      target_deal_id: 'deal-1', target_actor_name: 'Casey', target_net_revenue: 24000,
    }))
  })

  it('accepts a department handoff with the verified operator identity', async () => {
    mocks.rpc.mockResolvedValue({ data: { handoffId: 'handoff-1', status: 'accepted', replayed: false }, error: null })
    await acceptDepartmentHandoff({ handoffId: 'handoff-1', actorEmail: 'casey@savingkc.com', actorName: 'Casey' })
    expect(mocks.rpc).toHaveBeenCalledWith('crm_accept_department_handoff_v1', {
      target_handoff_id: 'handoff-1', target_actor_email: 'casey@savingkc.com', target_actor_name: 'Casey',
    })
  })

  it('finalizes verified fallout across lifecycle, TC, Dispositions, and Marketing', async () => {
    mocks.rpc.mockResolvedValue({ data: { deal: { id: 'deal-1', stage: 'dead' }, lifecycle: {}, marketingOutcome: {} }, error: null })
    await finalizeVerifiedFallout({
      dealId: 'deal-1', reason: 'title_issue', notes: 'Title company confirmed an incurable defect.',
      evidenceReference: 'Title email dated 2026-08-23', occurredAt: '2026-08-23T18:00:00.000Z',
      actorEmail: 'casey@savingkc.com', actorName: 'Casey',
    })
    expect(mocks.rpc).toHaveBeenCalledWith('crm_finalize_verified_fallout_v1', expect.objectContaining({
      target_deal_id: 'deal-1', target_reason: 'title_issue',
      target_evidence_reference: 'Title email dated 2026-08-23', target_actor_name: 'Casey',
    }))
  })
})
