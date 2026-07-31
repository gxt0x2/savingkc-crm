export type DispoCloseoutStatus = 'not_started' | 'awaiting_debrief' | 'complete'

export interface FundingCloseoutInput {
  fundedAt: string
  finalAssignmentFee: number
  closingCosts: number
  sellerPurchasePrice: number | null
  buyerPurchasePrice: number | null
  settlementStatementVerified: boolean
  fundingConfirmed: boolean
  notes: string | null
  recordedBy: string
}

export interface DebriefInput {
  outcomeRating: number
  buyerPerformance: number
  sourceQuality: number
  wentWell: string
  friction: string
  lesson: string
  processChange: string
  completedBy: string
}

export interface FundingMetrics {
  grossRevenue: number
  closingCosts: number
  netRevenue: number
  transactionSpread: number | null
  dispositionDays: number
  leadToCloseDays: number | null
}

function dateValue(value: string): number | null {
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : null
}

function elapsedDays(start: string | null | undefined, end: string): number | null {
  if (!start) return null
  const startMs = dateValue(start)
  const endMs = dateValue(end)
  if (startMs == null || endMs == null) return null
  return Math.max(0, Math.round((endMs - startMs) / 86_400_000))
}

export function nextBusinessDayDueAt(fundedAt: string): string {
  const funded = new Date(fundedAt)
  if (!Number.isFinite(funded.getTime())) throw new Error('A valid funding date is required')

  const due = new Date(funded)
  do {
    due.setUTCDate(due.getUTCDate() + 1)
  } while (due.getUTCDay() === 0 || due.getUTCDay() === 6)

  return due.toISOString()
}

export function sellerFollowupDueAt(fundedAt: string): string {
  const funded = new Date(fundedAt)
  if (!Number.isFinite(funded.getTime())) throw new Error('A valid funding date is required')
  funded.setUTCDate(funded.getUTCDate() + 7)
  return funded.toISOString()
}

export function validateFundingCloseout(input: FundingCloseoutInput): string[] {
  const errors: string[] = []
  if (dateValue(input.fundedAt) == null) errors.push('Funding date is required')
  if (!Number.isFinite(input.finalAssignmentFee) || input.finalAssignmentFee < 0) errors.push('Final assignment fee must be zero or greater')
  if (!Number.isFinite(input.closingCosts) || input.closingCosts < 0) errors.push('Closing costs must be zero or greater')
  if (!input.fundingConfirmed) errors.push('Funding must be confirmed')
  if (!input.settlementStatementVerified) errors.push('Settlement statement must be verified')
  return errors
}

export function validateDebrief(input: DebriefInput): string[] {
  const errors: string[] = []
  if (!Number.isInteger(input.outcomeRating) || input.outcomeRating < 1 || input.outcomeRating > 5) errors.push('Outcome rating must be between 1 and 5')
  if (!Number.isInteger(input.buyerPerformance) || input.buyerPerformance < 1 || input.buyerPerformance > 5) errors.push('Buyer performance must be between 1 and 5')
  if (!Number.isInteger(input.sourceQuality) || input.sourceQuality < 1 || input.sourceQuality > 5) errors.push('Source quality must be between 1 and 5')
  if (!input.wentWell.trim()) errors.push('Record what worked')
  if (!input.friction.trim()) errors.push('Record the primary friction point')
  if (!input.lesson.trim()) errors.push('Record the main lesson')
  if (!input.processChange.trim()) errors.push('Record the process change or state that none is needed')
  return errors
}

export function buildFundingMetrics(
  input: FundingCloseoutInput,
  dates: { enteredAt: string; leadCreatedAt?: string | null },
): FundingMetrics {
  const grossRevenue = Math.round(input.finalAssignmentFee * 100) / 100
  const closingCosts = Math.round(input.closingCosts * 100) / 100
  const spread = input.sellerPurchasePrice != null && input.buyerPurchasePrice != null
    ? Math.round((input.buyerPurchasePrice - input.sellerPurchasePrice) * 100) / 100
    : null

  return {
    grossRevenue,
    closingCosts,
    netRevenue: Math.round((grossRevenue - closingCosts) * 100) / 100,
    transactionSpread: spread,
    dispositionDays: elapsedDays(dates.enteredAt, input.fundedAt) ?? 0,
    leadToCloseDays: elapsedDays(dates.leadCreatedAt, input.fundedAt),
  }
}
