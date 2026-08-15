export const CALL_REVIEWERS = [
  { name: 'Ernest', email: 'ernest@savingkc.com' },
  { name: 'Casey', email: 'casey@savingkc.com' },
  { name: 'Gertha', email: 'gertha@savingkc.com' },
] as const

export function isCallReviewer(value: string): boolean {
  return CALL_REVIEWERS.some((reviewer) => reviewer.email === value)
}
