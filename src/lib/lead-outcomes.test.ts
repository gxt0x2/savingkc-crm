import { describe, expect, it } from 'vitest'
import { DEAD_REASONS, cleanDeadReason, deadReasonLabel, isNotLeadOutcome, isValidDeadReason } from './lead-outcomes'

describe('lead outcome dead reasons', () => {
  it('accepts business-wide dead reason ids', () => {
    expect(isValidDeadReason('dnc')).toBe(true)
    expect(isValidDeadReason('spam')).toBe(true)
    expect(isValidDeadReason('went_with_someone_else')).toBe(true)
    expect(isValidDeadReason('offer_too_low')).toBe(true)
    expect(isValidDeadReason('title_probate_bankruptcy_legal')).toBe(true)
  })

  it('normalizes legacy reasons into the reporting taxonomy', () => {
    expect(cleanDeadReason(' DNC ')).toBe('dnc_refused')
    expect(cleanDeadReason('disconnected')).toBe('wrong_or_disconnected')
    expect(cleanDeadReason('no_equity')).toBe('low_offer_or_equity')
    expect(cleanDeadReason('unknown')).toBeNull()
    expect(cleanDeadReason(null)).toBeNull()
  })

  it('labels stored reasons for activity and audit trails', () => {
    expect(deadReasonLabel('offer_too_low')).toBe('Offer too low / Not enough equity')
    expect(deadReasonLabel('spam_vendor_duplicate')).toBe('Spam / Vendor / Duplicate')
    expect(deadReasonLabel('legacy_reason')).toBe('Legacy Reason')
  })

  it('keeps the visible list to the eleven approved outcomes', () => {
    expect(DEAD_REASONS).toHaveLength(11)
    expect(DEAD_REASONS.map((reason) => reason.label)).toContain('Other — see notes')
  })

  it('keeps a dead classification out of active work even when stage data conflicts', () => {
    expect(isNotLeadOutcome('dead', 'under_contract')).toBe(true)
    expect(isNotLeadOutcome('dead', 'closed_won')).toBe(true)
    expect(isNotLeadOutcome('lead', 'dead')).toBe(true)
    expect(isNotLeadOutcome(null, 'closed_lost')).toBe(true)
    expect(isNotLeadOutcome('dead', null)).toBe(true)
    expect(isNotLeadOutcome('opportunity', 'qualified')).toBe(false)
  })
})
