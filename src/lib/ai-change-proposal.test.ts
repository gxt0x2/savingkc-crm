import { describe, expect, it } from 'vitest'
import { buildCallAnalysisLeadChanges, parseAiChangeProposal } from './ai-change-proposal'

const current = {
  motivation_score: 4,
  property_condition: 'fair',
  asking_price: 120000,
  opportunity_score: 40,
  classification: 'lead',
}

describe('AI change proposal contract', () => {
  it('keeps only bounded allowlisted changes and preserves the prior values', () => {
    expect(buildCallAnalysisLeadChanges({
      motivationScore: 8,
      conditionOverall: 'GOOD',
      sellerAsking: 175000,
      opportunity_score: 82,
      classification: 'opportunity',
      appointmentDateTime: '2026-09-01T15:00:00Z',
    }, current)).toEqual({
      proposedChanges: {
        motivation_score: 8,
        property_condition: 'good',
        asking_price: 175000,
        opportunity_score: 82,
        classification: 'opportunity',
      },
      baseSnapshot: current,
    })
  })

  it('drops invalid, unchanged, and consequential unsupported values', () => {
    expect(buildCallAnalysisLeadChanges({
      motivationScore: 11,
      conditionOverall: 'destroyed',
      sellerAsking: -1,
      opportunity_score: 40,
      classification: 'lead',
      coOwners: ['Someone'],
    }, current)).toBeNull()
  })

  it('never converts an AI low-score classification into a dead lead', () => {
    expect(buildCallAnalysisLeadChanges({ classification: 'dead' }, current)).toBeNull()
  })

  it('parses a safe UI contract without exposing arbitrary payload keys', () => {
    expect(parseAiChangeProposal({
      id: 'proposal-1',
      status: 'proposed',
      summary: 'Review the extracted seller facts.',
      proposed_changes: { motivation_score: 8, appointment_date: 'hidden' },
      base_snapshot: { motivation_score: 4, appointment_date: null },
    })).toEqual(expect.objectContaining({
      status: 'proposed',
      changes: [{ field: 'motivation_score', label: 'Motivation score', before: 4, proposed: 8 }],
    }))
  })
})
