/**
 * Ghost Risk Score Calculator
 * Pure function: reads manifest appointment data, returns 0-100 score
 * Called by reminder worker and SMS webhook after every relevant event
 */

export function calculateGhostRisk(manifest: any): number {
  const appt = manifest?.pipeline?.appointment
  if (!appt) return 0

  let score = 0

  // Factor 1: No reply to confirmation SMS (+25 per missed, cap at 2)
  // Check automationLog for confirmation requests without sellerResponded
  const confirmRequests = (appt.automationLog || []).filter(
    (e: any) => e.action?.includes('confirm') && !e.sellerResponded
  )
  score += Math.min(confirmRequests.length, 2) * 25

  // Factor 2: Hours since last seller response (+2/hr, max +30)
  if (appt.lastSellerResponse) {
    const hoursSince = (Date.now() - new Date(appt.lastSellerResponse).getTime()) / 3600000
    // Only count after first missed reply (i.e., if there are confirm requests without response)
    if (confirmRequests.length > 0) {
      score += Math.min(Math.floor(hoursSince) * 2, 30)
    }
  } else if ((appt.automationLog || []).length > 0) {
    // Never responded at all but we've sent messages
    score += 30
  }

  // Factor 3: Seller replied but didn't confirm (+15)
  const ambiguousReplies = (appt.automationLog || []).filter(
    (e: any) => e.sellerResponded && e.action?.includes('ambiguous')
  )
  score += ambiguousReplies.length * 15

  // Factor 4: Inbound lead (-20) — motivated sellers ghost less
  const source = manifest.source || ''
  if (source === 'inbound' || source === 'inbound_call' || source === 'sms_yes_reply') {
    score -= 20
  }

  // Factor 5: Prior completed appointments (-10 each)
  const completedAppts = (manifest.auditTrail || []).filter(
    (e: any) => e.action === 'appointment_completed'
  )
  score -= completedAppts.length * 10

  // Factor 6: Appointment rescheduled
  const reschedules = (manifest.auditTrail || []).filter(
    (e: any) => e.action === 'appointment_rescheduled'
  )
  if (reschedules.length === 1) score += 10
  if (reschedules.length >= 2) score += 30

  // Clamp to 0-100
  return Math.max(0, Math.min(100, score))
}
