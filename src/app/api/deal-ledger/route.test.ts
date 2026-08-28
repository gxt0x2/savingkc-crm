import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdminOrSecret: vi.fn(),
  requireUserOrSecret: vi.fn(),
  listDealLedgerLines: vi.fn(),
  postDealLedgerLine: vi.fn(),
}))

vi.mock('@/lib/api/admin-auth', () => ({
  requireAdminOrSecret: mocks.requireAdminOrSecret,
  requireUserOrSecret: mocks.requireUserOrSecret,
}))
vi.mock('@/lib/server/deal-ledger', () => ({
  DealLedgerError: class DealLedgerError extends Error {},
  listDealLedgerLines: mocks.listDealLedgerLines,
  postDealLedgerLine: mocks.postDealLedgerLine,
}))

import { GET, POST } from './route'

const assignmentLine = {
  id: 'line-1',
  lead_id: '2e3b2b37-ebce-4078-86e8-540eab90ad47',
  tc_file_id: 'tc-file-1',
  dispo_deal_id: 'deal-1',
  file_number: '605807',
  property_address: '5621 W 151st Ter',
  amount: 20000,
  direction: 'in',
  posted_on: '2026-05-08',
  source: '96a9cd10-4b12-11f1-9150-33da0a1e0aa3',
  memo: 'Alliance National Title assignment fee',
  category: 'assignment_fee',
  idempotency_key: '96a9cd10-4b12-11f1-9150-33da0a1e0aa3:assignment_fee:in',
  actor: 'treasury',
  created_at: '2026-08-28T04:00:00.000Z',
}

const transactionLine = {
  ...assignmentLine,
  id: 'line-2',
  amount: 585,
  category: 'transaction_fee',
  memo: 'Alliance National Title transaction fee',
  idempotency_key: '96a9cd10-4b12-11f1-9150-33da0a1e0aa3:transaction_fee:in',
}

describe('/api/deal-ledger', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAdminOrSecret.mockResolvedValue(null)
    mocks.requireUserOrSecret.mockResolvedValue(null)
    mocks.listDealLedgerLines.mockResolvedValue([assignmentLine, transactionLine])
    mocks.postDealLedgerLine.mockResolvedValue({ line: assignmentLine, replayed: false })
  })

  it('rejects untrusted writes before parsing', async () => {
    mocks.requireAdminOrSecret.mockResolvedValue(new Response('Unauthorized', { status: 401 }))
    const response = await POST(new Request('https://crm.savingkc.com/api/deal-ledger', {
      method: 'POST',
      body: '{',
    }) as never)
    expect(response.status).toBe(401)
    expect(mocks.postDealLedgerLine).not.toHaveBeenCalled()
  })

  it('posts one line and reads the two Alliance splits back', async () => {
    const post = await POST(new Request('https://crm.savingkc.com/api/deal-ledger', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lead_id: assignmentLine.lead_id,
        file_number: '605807',
        property_address: '5621 W 151st Ter',
        amount: 20000,
        direction: 'in',
        date: '2026-05-08',
        source: assignmentLine.source,
        memo: assignmentLine.memo,
        category: 'assignment_fee',
      }),
    }) as never)
    expect(post.status).toBe(201)

    const get = await GET(new Request(
      'https://crm.savingkc.com/api/deal-ledger?lead_id=2e3b2b37-ebce-4078-86e8-540eab90ad47&file_number=605807',
    ) as never)
    const body = await get.json()
    expect(get.status).toBe(200)
    expect(body.lines).toHaveLength(2)
    expect(body.lines[0].amount + body.lines[1].amount).toBe(20585)
  })
})
