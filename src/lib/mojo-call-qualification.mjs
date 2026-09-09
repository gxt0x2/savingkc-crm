export const MOJO_MINIMUM_MEANINGFUL_SECONDS = 120

const PROMOTION_OUTCOMES = new Set([
  'callback_scheduled',
  'meaningful_conversation',
  'appointment_set',
])

const NEGATIVE_PATTERNS = [
  /\bnot interested\b/i,
  /\bno thank(?:s| you)\b/i,
  /\bdo not call\b/i,
  /\bdnc\b/i,
  /\bwrong number\b/i,
  /\b(?:abruptly\s+)?hung up\b/i,
  /\bhang up\b/i,
  /\balready sold\b/i,
  /\blisted with (?:an?|their) agent\b/i,
]

const SELLER_INTEL_PATTERNS = [
  ['timeline', /\b(?:timeline|sell(?:ing)? within|close within|days?|weeks?|months?)\s*:/i],
  ['motivation', /\b(?:motivation|reason for selling|wants? to sell|needs? to sell)\b/i],
  ['price', /\b(?:asking price|price\s*:|offer\s*:|\$\s?\d|\d[\d,]*\s?k\b)/i],
  ['condition', /\b(?:condition|repairs?|renovat|foundation|roof|hvac|flood|fire damage)\b/i],
  ['property_situation', /\b(?:inherited|probate|foreclosure|tenant|vacant|rent back|equity|liens?)\b/i],
]

function text(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function duration(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(0, Math.trunc(parsed)) : 0
}

function boolean(value) {
  return value === true || value === 'true'
}

function validDate(value) {
  const candidate = text(value)
  return Boolean(candidate && Number.isFinite(Date.parse(candidate)))
}

export function mojoSellerIntelSignals(notes) {
  const value = text(notes)
  return SELLER_INTEL_PATTERNS
    .filter(([, pattern]) => pattern.test(value))
    .map(([signal]) => signal)
}

export function mojoNegativeIntentSignals(notes) {
  const value = text(notes)
  return NEGATIVE_PATTERNS
    .filter((pattern) => pattern.test(value))
    .map((pattern) => pattern.source)
}

export function assessMojoCallQualification(call, options = {}) {
  const outcome = text(call?.outcome || call?.disposition_outcome)
  const seconds = duration(call?.durationSeconds ?? call?.call_duration)
  const notes = text(call?.notes)
  const recordingUrl = text(call?.recordingUrl ?? call?.recording_url)
  const followUpAt = call?.followUpAt ?? call?.follow_up_date
  const hasAppointment = boolean(call?.hasAppointment ?? call?.has_appointment)
    || outcome === 'appointment_set'
  const qualifiedByAgent = boolean(call?.qualifiedByAgent ?? call?.qualified_by_agent)
  const minimumSeconds = Math.max(
    1,
    duration(options.minimumSeconds ?? MOJO_MINIMUM_MEANINGFUL_SECONDS),
  )
  const reasons = []
  const sellerIntel = mojoSellerIntelSignals(notes)
  const negativeIntent = mojoNegativeIntentSignals(notes)

  if (!PROMOTION_OUTCOMES.has(outcome)) {
    return {
      eligible: false,
      status: 'not_applicable',
      reasons: ['non_promotion_outcome'],
      minimumSeconds,
      durationSeconds: seconds,
      sellerIntel,
      negativeIntent,
    }
  }

  if (negativeIntent.length > 0) {
    return {
      eligible: false,
      status: 'ineligible',
      reasons: ['negative_intent'],
      minimumSeconds,
      durationSeconds: seconds,
      sellerIntel,
      negativeIntent,
    }
  }

  const scheduledAppointment = hasAppointment && validDate(followUpAt)
  if (scheduledAppointment) {
    reasons.push('scheduled_appointment_override')
    if (!recordingUrl) reasons.push('recording_pending')
    return {
      eligible: true,
      status: 'eligible',
      reasons,
      minimumSeconds,
      durationSeconds: seconds,
      sellerIntel,
      negativeIntent,
    }
  }

  if (outcome === 'callback_scheduled' && !validDate(followUpAt)) {
    return {
      eligible: false,
      status: 'ineligible',
      reasons: ['callback_without_scheduled_time'],
      minimumSeconds,
      durationSeconds: seconds,
      sellerIntel,
      negativeIntent,
    }
  }

  if (!recordingUrl || seconds === 0) {
    return {
      eligible: false,
      status: 'evidence_pending',
      reasons: [!recordingUrl ? 'recording_pending' : 'duration_pending'],
      minimumSeconds,
      durationSeconds: seconds,
      sellerIntel,
      negativeIntent,
    }
  }

  if (seconds < minimumSeconds) {
    return {
      eligible: false,
      status: 'ineligible',
      reasons: ['below_minimum_duration'],
      minimumSeconds,
      durationSeconds: seconds,
      sellerIntel,
      negativeIntent,
    }
  }

  if (!qualifiedByAgent && sellerIntel.length === 0) {
    return {
      eligible: false,
      status: 'ineligible',
      reasons: ['missing_seller_intent_evidence'],
      minimumSeconds,
      durationSeconds: seconds,
      sellerIntel,
      negativeIntent,
    }
  }

  reasons.push(qualifiedByAgent ? 'agent_qualified' : 'seller_intent_documented')
  reasons.push('minimum_duration_met')
  if (outcome === 'callback_scheduled') reasons.push('callback_scheduled')

  return {
    eligible: true,
    status: 'eligible',
    reasons,
    minimumSeconds,
    durationSeconds: seconds,
    sellerIntel,
    negativeIntent,
  }
}
