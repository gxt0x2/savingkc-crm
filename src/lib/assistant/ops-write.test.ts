import { describe, expect, it, vi } from 'vitest'
import {
  CLOSED_CASH_STAGES,
  isForbiddenMoneyAction,
  updateDealFileOps,
  updateLeadStage,
} from './ops-write'

describe('assistant ops write (except money)', () => {
  it('treats ledger, assignment fee, and treasury actions as money', () => {
    expect(isForbiddenMoneyAction('update_assignment_fee')).toBe(true)
    expect(isForbiddenMoneyAction('post_ledger')).toBe(true)
    expect(isForbiddenMoneyAction('write_treasury')).toBe(true)
    expect(isForbiddenMoneyAction('add_lead_note')).toBe(false)
    expect(CLOSED_CASH_STAGES).toEqual(['closed_won', 'closed_lost', 'closed'])
  })

  it('rejects closed-cash lead stages before touching lifecycle', async () => {
    await expect(updateLeadStage(
      { email: 'ernest@savingkc.com', fullName: 'Ernest', role: 'owner', access: 'owner' },
      '00000000-0000-4000-8000-000000000001',
      'closed_won',
      { commandId: '00000000-0000-4000-8000-000000000002' },
    )).rejects.toThrow(/Closed-cash/)
  })

  it('updates deal-file next action and notes without money fields', async () => {
    const update = vi.fn().mockReturnValue({ eq: async () => ({ error: null }) })
    const from = vi.fn((table: string) => {
      if (table === 'tc_files') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: '00000000-0000-4000-8000-000000000003', lead_id: '00000000-0000-4000-8000-000000000001', next_action: null, notes: null, dispo_deal_id: null },
                error: null,
              }),
            }),
          }),
          update,
        }
      }
      return { update }
    })

    const result = await updateDealFileOps({ from }, {
      fileId: '00000000-0000-4000-8000-000000000003',
      nextAction: 'Call title',
      notes: 'Waiting on commitment',
    })

    expect(from).toHaveBeenCalledWith('tc_files')
    expect(from).not.toHaveBeenCalledWith('crm_deal_ledger_lines')
    expect(from).not.toHaveBeenCalledWith('revenue_transactions')
    expect(update).toHaveBeenCalledWith({ next_action: 'Call title', notes: 'Waiting on commitment' })
    expect(result.writeScope).toBe('ops_except_money')
  })
})
