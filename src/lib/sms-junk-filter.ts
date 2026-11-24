/**
 * Inbound SMS junk filter (handoff Item 11).
 *
 * Bulk vendor / survey / association blasts ("Missouri REALTORS: … take a
 * short survey … Text STOP to quit") were creating "SMS Lead" records and
 * paging agents with unknown_sms_alert. A real seller does not end a text
 * with a carrier bulk-messaging footer, so we require BOTH:
 *   1. a bulk-sender opt-out/help footer, and
 *   2. at least one marketing signal (link, survey/prize wording, or a
 *      "Brand Name:" sender prefix).
 * A plain seller message (with or without a link) is never junk on its own.
 *
 * This only classifies. Callers must never write sms_opt_outs or DNC state
 * from this result, and must never auto-reply to junk.
 */

export type JunkSmsReason = 'bulk_survey' | 'bulk_marketing'

const BULK_FOOTER = [
  /\b(?:text|txt|reply|send)\s+stop\s+to\s+(?:quit|end|opt[\s-]?out|unsubscribe|cancel|stop)\b/i,
  /\bstop\s+to\s+(?:quit|end|opt[\s-]?out|unsubscribe|cancel)\b/i,
  /\breply\s+help\s+for\s+help\b/i,
  /\bmsg\s*(?:&|and)\s*data\s+rates\s+may\s+apply\b/i,
]

const SURVEY_SIGNAL = /\b(?:survey|your opinion matters|share your (?:views|feedback|opinion)|questionnaire|rate your experience)\b/i
const PRIZE_SIGNAL = /\b(?:gift cards?|enter to win|sweepstakes|chance to win|promo code|% off|limited time offer)\b/i
const LINK_SIGNAL = /\bhttps?:\/\/\S+|\bwww\.\S+\.\S+/i
const BRAND_PREFIX = /^\s*[A-Z][A-Za-z0-9&'.\- ]{2,40}:\s/

export function classifyJunkInboundSms(body: string | null | undefined): { junk: true; reason: JunkSmsReason } | null {
  const text = (body ?? '').trim()
  if (!text) return null
  if (!BULK_FOOTER.some((pattern) => pattern.test(text))) return null
  if (SURVEY_SIGNAL.test(text)) return { junk: true, reason: 'bulk_survey' }
  if (PRIZE_SIGNAL.test(text) || LINK_SIGNAL.test(text) || BRAND_PREFIX.test(text)) {
    return { junk: true, reason: 'bulk_marketing' }
  }
  return null
}
