import { describe, expect, it } from 'vitest'
import {
  LEDGER_REVIEW_REASON,
  ROLE_REVIEW_REASON,
  STALE_VALID_REASON,
  coldLedgerDispatchHold,
  coldLedgerReviewReasons,
  ledgerReadyForColdSend,
  restoreRoleMailboxReview,
  verificationStateIgnoringLedger,
} from './cold-send'

const now = new Date('2026-11-14T00:00:00.000Z')
const fresh = '2026-11-01T00:00:00.000Z'
const stale = '2026-09-01T00:00:00.000Z'

describe('cold send ledger review', () => {
  it('holds catch_all, unknown, and unverified even when the address record is valid', () => {
    for (const emailStatus of ['catch_all', 'unknown', 'unverified'] as const) {
      const ledger = { emailStatus, checkedAt: fresh, isRole: false }
      expect(coldLedgerReviewReasons(ledger, now)).toContain(LEDGER_REVIEW_REASON)
      expect(ledgerReadyForColdSend(ledger, now)).toBe(false)
      expect(coldLedgerDispatchHold(ledger, now)).toBe(true)
    }
  })

  it('lets a fresh valid ledger reach Ready and withholds one older than 30 days', () => {
    expect(ledgerReadyForColdSend({ emailStatus: 'valid', checkedAt: fresh, isRole: false }, now)).toBe(true)
    expect(coldLedgerReviewReasons({ emailStatus: 'valid', checkedAt: fresh, isRole: false }, now)).toEqual([])
    expect(ledgerReadyForColdSend({ emailStatus: 'valid', checkedAt: stale, isRole: false }, now)).toBe(false)
    expect(coldLedgerReviewReasons({ emailStatus: 'valid', checkedAt: stale, isRole: false }, now)).toContain(STALE_VALID_REASON)
    expect(coldLedgerDispatchHold({ emailStatus: 'valid', checkedAt: stale, isRole: false }, now)).toBe(true)
  })

  it('excludes a role mailbox until a reviewer restores it', () => {
    const ledger = { emailStatus: 'valid', checkedAt: fresh, isRole: true }
    expect(coldLedgerReviewReasons(ledger, now)).toContain(ROLE_REVIEW_REASON)
    expect(ledgerReadyForColdSend(ledger, now)).toBe(false)
    const restored = restoreRoleMailboxReview([ROLE_REVIEW_REASON])
    expect(restored.eligibility).toBe('eligible')
    expect(coldLedgerReviewReasons(ledger, now, restored.reasonCodes)).toEqual([])
    expect(ledgerReadyForColdSend(ledger, now, restored.reasonCodes)).toBe(true)
  })

  it('does not let a ledger valid status promote the address verification state', () => {
    expect(verificationStateIgnoringLedger('unknown', 'valid')).toBe('unknown')
    expect(verificationStateIgnoringLedger('unverified', 'valid')).toBe('unverified')
  })
})
