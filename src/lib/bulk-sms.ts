// Pure helpers for bulk SMS — kept separate from the route so they're unit
// testable without a DB or Twilio.

/** Max recipients per bulk request. Larger campaigns belong in the queued worker. */
export const BULK_SMS_MAX = 200

export type BulkSmsStatus = 'sent' | 'skipped' | 'failed'
export type BulkSmsReason = 'opted_out' | 'duplicate' | 'no_phone' | 'not_found'

export interface BulkSmsItem {
  leadId: string
  status: BulkSmsStatus
  reason?: BulkSmsReason
  error?: string
}

export interface BulkSmsSummary {
  total: number
  sent: number
  skipped: number
  failed: number
  breakdown: Record<BulkSmsReason, number>
}

export function summarizeBulkSms(items: BulkSmsItem[]): BulkSmsSummary {
  const breakdown: Record<BulkSmsReason, number> = { opted_out: 0, duplicate: 0, no_phone: 0, not_found: 0 }
  let sent = 0, skipped = 0, failed = 0
  for (const it of items) {
    if (it.status === 'sent') sent++
    else if (it.status === 'failed') failed++
    else {
      skipped++
      if (it.reason) breakdown[it.reason]++
    }
  }
  return { total: items.length, sent, skipped, failed, breakdown }
}

/**
 * Texting-hours guard. Matches the automated SMS worker: Mon–Sat, 9am–7pm
 * Central. (Recipients span timezones; Central is the house standard. See the
 * multi-timezone TCPA note in the bulk route.)
 */
export function isWithinTextingHours(now: Date = new Date()): boolean {
  const central = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }))
  const hour = central.getHours()
  const day = central.getDay() // 0 = Sun
  return day >= 1 && day <= 6 && hour >= 9 && hour < 19
}

/** Human one-liner for a finished bulk run. */
export function describeBulkResult(s: BulkSmsSummary): string {
  const parts = [`${s.sent} sent`]
  if (s.skipped) {
    const reasons: string[] = []
    if (s.breakdown.opted_out) reasons.push(`${s.breakdown.opted_out} opted out`)
    if (s.breakdown.duplicate) reasons.push(`${s.breakdown.duplicate} duplicate`)
    if (s.breakdown.no_phone) reasons.push(`${s.breakdown.no_phone} no phone`)
    if (s.breakdown.not_found) reasons.push(`${s.breakdown.not_found} not found`)
    parts.push(`${s.skipped} skipped${reasons.length ? ` (${reasons.join(', ')})` : ''}`)
  }
  if (s.failed) parts.push(`${s.failed} failed`)
  return parts.join(' · ')
}
