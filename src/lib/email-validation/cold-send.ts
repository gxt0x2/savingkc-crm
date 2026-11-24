import { isBadEmailStatus } from './status'

/** Cold outreach only. Transactional mail, newsletter signup, and buyer broadcasts do not use this. */
export const HARD_BLOCK_REASON = 'Email address cannot be mailed'
export const LEDGER_REVIEW_REASON = 'Email status needs review'
export const STALE_VALID_REASON = 'Email verification is older than 30 days'
export const ROLE_REVIEW_REASON = 'Role mailbox needs review'
export const ROLE_RESTORED = 'role_mailbox_restored'
export const LEDGER_READY_MS = 30 * 86_400_000

export type ColdLedger = {
  emailStatus?: string | null
  checkedAt?: string | Date | null
  isRole?: boolean | null
} | null

/** A ledger result never overwrites em_addresses.verification_state. */
export function verificationStateIgnoringLedger<T extends string>(importedState: T, ledgerStatus?: string | null): T {
  return ledgerStatus === 'valid' ? importedState : importedState
}

function checkedAtMs(value: string | Date | null | undefined): number {
  if (!value) return Number.NaN
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime()
  return ms
}

export function ledgerValidWithin30Days(ledger: ColdLedger, now: Date): boolean {
  if (ledger?.emailStatus !== 'valid') return false
  const checked = checkedAtMs(ledger.checkedAt)
  return Number.isFinite(checked) && now.getTime() - checked <= LEDGER_READY_MS && now.getTime() >= checked
}

/** Fresh ledger valid, and not an unrestored role mailbox, can reach Ready. */
export function ledgerReadyForColdSend(ledger: ColdLedger, now: Date, reasonCodes?: readonly string[] | null): boolean {
  if (!ledgerValidWithin30Days(ledger, now)) return false
  if (ledger?.isRole && !roleRestored(reasonCodes)) return false
  return true
}

function roleRestored(reasonCodes?: readonly string[] | null): boolean {
  return Array.isArray(reasonCodes) && reasonCodes.includes(ROLE_RESTORED)
}

/**
 * Review reasons for a ledger row. Missing ledger does not invent a reason.
 * catch_all, unknown, unverified, and stale valid stay in review even when
 * em_addresses.verification_state is valid. A reviewer restores only a role mailbox.
 */
export function coldLedgerReviewReasons(ledger: ColdLedger, now: Date, reasonCodes?: readonly string[] | null): string[] {
  if (!ledger?.emailStatus) return []
  const reasons: string[] = []
  if (isBadEmailStatus(ledger.emailStatus)) reasons.push(HARD_BLOCK_REASON)
  if (ledger.emailStatus === 'catch_all' || ledger.emailStatus === 'unknown' || ledger.emailStatus === 'unverified') {
    reasons.push(LEDGER_REVIEW_REASON)
  }
  if (ledger.emailStatus === 'valid' && !ledgerValidWithin30Days(ledger, now)) reasons.push(STALE_VALID_REASON)
  if (ledger.isRole && !roleRestored(reasonCodes)) reasons.push(ROLE_REVIEW_REASON)
  return reasons
}

/** Hosted cold dispatch holds these. Hard blocks stay on isBadEmailStatus. Role was decided at review. */
export function coldLedgerDispatchHold(ledger: ColdLedger, now: Date): boolean {
  return coldLedgerReviewReasons(ledger ? { ...ledger, isRole: false } : null, now).some((reason) => reason !== HARD_BLOCK_REASON)
}

export function coldLedgerBlocksDispatch(ledger: ColdLedger, now: Date, reasonCodes?: readonly string[] | null): boolean {
  return coldLedgerReviewReasons(ledger, now, reasonCodes).length > 0
}

/** Drop the role review reason and record that a reviewer restored the mailbox. */
export function restoreRoleMailboxReview(reasonCodes: readonly string[]): { eligibility: 'eligible' | 'needs_review'; reasonCodes: string[] } {
  const next = [...reasonCodes.filter((reason) => reason !== ROLE_REVIEW_REASON && reason !== ROLE_RESTORED), ROLE_RESTORED]
  const blocking = next.filter((reason) => reason !== ROLE_RESTORED)
  return { eligibility: blocking.length === 0 ? 'eligible' : 'needs_review', reasonCodes: next }
}
