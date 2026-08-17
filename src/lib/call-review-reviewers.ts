export const CALL_REVIEWERS = [
  { name: 'Ernest', email: 'ernest@savingkc.com' },
  { name: 'Gertha', email: 'gertha@savingkc.com' },
] as const

export const DEFAULT_CALL_REVIEWER = CALL_REVIEWERS[0]

export function isCallReviewer(value: string): boolean {
  return CALL_REVIEWERS.some((reviewer) => reviewer.email === value)
}
