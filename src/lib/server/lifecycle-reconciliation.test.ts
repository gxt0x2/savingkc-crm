import { describe, expect, it } from 'vitest'
import { summarizeLifecycleReconciliation } from './lifecycle-reconciliation'

describe('lifecycle evidence reconciliation', () => {
  it('keeps legacy gaps visible without manufacturing evidence', () => {
    const snapshot = summarizeLifecycleReconciliation({
      now: new Date('2026-08-23T18:00:00.000Z'),
      deals: [
        { id: 'deal-1', lead_id: 'lead-1', stage: 'closed', accepted_offer_id: 'offer-1' },
        { id: 'deal-2', lead_id: 'lead-2', stage: 'marketing', accepted_offer_id: null },
      ],
      closingFiles: [
        { id: 'file-1', lead_id: 'lead-1', dispo_deal_id: 'deal-1', buyer_offer_id: 'offer-1', status: 'closed' },
        { id: 'file-2', lead_id: 'lead-2', dispo_deal_id: null, buyer_offer_id: null, status: 'opened' },
      ],
      offers: [{ id: 'offer-1', lead_id: 'lead-1', status: 'accepted', assignment_signed_at: null }],
      handoffs: [],
      outcomes: [],
      leads: [
        { id: 'lead-1', full_name: 'Seller One', property_address: '1 Main St', city: 'Kansas City', state: 'MO' },
        { id: 'lead-2', full_name: 'Seller Two', property_address: '2 Oak St', city: 'Raytown', state: 'MO' },
      ],
    })
    expect(snapshot.counts).toEqual({
      reviewedDeals: 2,
      reviewedClosingFiles: 2,
      missingSellerHandoffs: 2,
      missingAssignmentHandoffs: 2,
      missingCloseOutcomes: 1,
      orphanClosingFiles: 1,
    })
    expect(snapshot.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'seller_handoff', title: '1 Main St · Kansas City, MO' }),
      expect.objectContaining({ kind: 'close_outcome' }),
      expect.objectContaining({ kind: 'orphan_closing_file' }),
    ]))
  })

  it('recognizes only governed signed handoffs and matching verified outcomes', () => {
    const snapshot = summarizeLifecycleReconciliation({
      now: new Date('2026-08-23T18:00:00.000Z'),
      deals: [{ id: 'deal-1', lead_id: 'lead-1', stage: 'closed', accepted_offer_id: 'offer-1' }],
      closingFiles: [{ id: 'file-1', lead_id: 'lead-1', dispo_deal_id: 'deal-1', buyer_offer_id: 'offer-1', status: 'closed' }],
      offers: [{ id: 'offer-1', lead_id: 'lead-1', status: 'accepted', assignment_signed_at: '2026-08-20T00:00:00.000Z' }],
      handoffs: [
        { lead_id: 'lead-1', from_department: 'acquisitions', to_department: 'dispositions', source_record_type: 'seller_contract', source_record_id: 'contract-1' },
        { lead_id: 'lead-1', from_department: 'dispositions', to_department: 'transaction_coordination', source_record_type: 'buyer_offer', source_record_id: 'offer-1' },
      ],
      outcomes: [{ lead_id: 'lead-1', outcome: 'closed_won' }],
      leads: [],
    })
    expect(snapshot.issues).toEqual([])
    expect(snapshot.counts.missingCloseOutcomes).toBe(0)
  })
})
