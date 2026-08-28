import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DealLedgerLine } from '@/types/deal-ledger'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ rpc: mocks.rpc, from: mocks.from }),
}))

import { DealLedgerError, listDealLedgerLines, postDealLedgerLine } from './deal-ledger'

const ALLIANCE_DEAL = {
  leadId: '2e3b2b37-ebce-4078-86e8-540eab90ad47',
  fileNumber: '605807',
  propertyAddress: '5621 W 151st Ter',
  source: '96a9cd10-4b12-11f1-9150-33da0a1e0aa3',
  postedOn: '2026-05-08',
}

function line(partial: Partial<DealLedgerLine> & Pick<DealLedgerLine, 'id' | 'amount' | 'category'>): DealLedgerLine {
  return {
    lead_id: ALLIANCE_DEAL.leadId,
    tc_file_id: 'tc-file-1',
    dispo_deal_id: 'deal-1',
    file_number: ALLIANCE_DEAL.fileNumber,
    property_address: ALLIANCE_DEAL.propertyAddress,
    direction: 'in',
    posted_on: ALLIANCE_DEAL.postedOn,
    source: ALLIANCE_DEAL.source,
    memo: null,
    idempotency_key: `${ALLIANCE_DEAL.source}:${partial.category}:in`,
    actor: 'treasury',
    created_at: '2026-08-28T04:00:00.000Z',
    ...partial,
  }
}

function query(result: DealLedgerLine[]) {
  const builder: Record<string, unknown> = {}
  builder.select = () => builder
  builder.eq = () => builder
  builder.order = () => builder
  builder.limit = () => builder
  builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
    Promise.resolve({ data: result, error: null }).then(resolve, reject)
  return builder
}

describe('Deal File ledger write path', () => {
  const store: DealLedgerLine[] = []

  beforeEach(() => {
    store.length = 0
    vi.clearAllMocks()
    mocks.rpc.mockImplementation(async (_name: string, args: Record<string, unknown>) => {
      const existing = store.find(
        (row) =>
          row.source === args.target_source &&
          row.category === args.target_category &&
          row.direction === args.target_direction,
      )
      if (existing) {
        if (Number(existing.amount) !== Number(args.target_amount) || existing.posted_on !== args.target_posted_on) {
          return { data: null, error: { message: 'ledger_line_conflict' } }
        }
        return { data: { line: existing, replayed: true }, error: null }
      }
      const created = line({
        id: `line-${store.length + 1}`,
        amount: Number(args.target_amount),
        category: args.target_category as DealLedgerLine['category'],
        memo: typeof args.target_memo === 'string' ? args.target_memo : null,
      })
      store.push(created)
      return { data: { line: created, replayed: false }, error: null }
    })
    mocks.from.mockImplementation(() => query(store))
  })

  it('writes two Alliance split lines to the 5621 deal and reads them back', async () => {
    const assignment = await postDealLedgerLine({
      leadId: ALLIANCE_DEAL.leadId,
      fileNumber: ALLIANCE_DEAL.fileNumber,
      propertyAddress: ALLIANCE_DEAL.propertyAddress,
      amount: 20000,
      direction: 'in',
      postedOn: ALLIANCE_DEAL.postedOn,
      source: ALLIANCE_DEAL.source,
      memo: 'Alliance National Title assignment fee',
      category: 'assignment_fee',
      actor: 'treasury',
    })
    const transaction = await postDealLedgerLine({
      leadId: ALLIANCE_DEAL.leadId,
      fileNumber: ALLIANCE_DEAL.fileNumber,
      propertyAddress: ALLIANCE_DEAL.propertyAddress,
      amount: 585,
      direction: 'in',
      postedOn: ALLIANCE_DEAL.postedOn,
      source: ALLIANCE_DEAL.source,
      memo: 'Alliance National Title transaction fee',
      category: 'transaction_fee',
      actor: 'treasury',
    })

    const lines = await listDealLedgerLines({
      leadId: ALLIANCE_DEAL.leadId,
      fileNumber: ALLIANCE_DEAL.fileNumber,
    })

    expect(assignment.replayed).toBe(false)
    expect(transaction.replayed).toBe(false)
    expect(lines).toHaveLength(2)
    expect(lines.map((row) => [row.category, row.amount, row.direction])).toEqual([
      ['assignment_fee', 20000, 'in'],
      ['transaction_fee', 585, 'in'],
    ])
    expect(lines.reduce((sum, row) => sum + row.amount, 0)).toBe(20585)
    expect(lines.every((row) => row.lead_id === ALLIANCE_DEAL.leadId)).toBe(true)
    expect(lines.every((row) => row.file_number === ALLIANCE_DEAL.fileNumber)).toBe(true)
    expect(lines.every((row) => row.source === ALLIANCE_DEAL.source)).toBe(true)
  })

  it('replays an identical line and refuses a silent amount overwrite', async () => {
    await postDealLedgerLine({
      leadId: ALLIANCE_DEAL.leadId,
      amount: 20000,
      direction: 'in',
      postedOn: ALLIANCE_DEAL.postedOn,
      source: ALLIANCE_DEAL.source,
      category: 'assignment_fee',
    })

    const replay = await postDealLedgerLine({
      leadId: ALLIANCE_DEAL.leadId,
      amount: 20000,
      direction: 'in',
      postedOn: ALLIANCE_DEAL.postedOn,
      source: ALLIANCE_DEAL.source,
      category: 'assignment_fee',
    })
    expect(replay.replayed).toBe(true)

    await expect(postDealLedgerLine({
      leadId: ALLIANCE_DEAL.leadId,
      amount: 19999,
      direction: 'in',
      postedOn: ALLIANCE_DEAL.postedOn,
      source: ALLIANCE_DEAL.source,
      category: 'assignment_fee',
    })).rejects.toMatchObject({ code: 'conflict', status: 409 })
  })
})

describe('Deal File ledger errors', () => {
  beforeEach(() => vi.clearAllMocks())

  it('fails closed when the command is missing', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'function missing' } })
    await expect(postDealLedgerLine({
      leadId: ALLIANCE_DEAL.leadId,
      amount: 20000,
      direction: 'in',
      postedOn: ALLIANCE_DEAL.postedOn,
      source: ALLIANCE_DEAL.source,
      category: 'assignment_fee',
    })).rejects.toBeInstanceOf(DealLedgerError)
  })
})
