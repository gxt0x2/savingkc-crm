import { classifyJunkInboundSms } from '@/lib/sms-junk-filter'

/**
 * Explicit selling-intent gate.
 *
 * A contact is paged as a seller only when the inbound text itself says they
 * want to sell or want an offer on their property. Everything else stays a
 * prospect. The check fails closed: missing text, a bare dollar amount, a
 * lone "Y", or "YES" that is not a reply to the company's sell auto-text
 * are not intent.
 */

export type SellingIntentResult =
  | { intent: true; quote: string; reason: string }
  | { intent: false; reason: string }

const INDUSTRY_SENDER = /\b(?:missouri\s+realtors|kcrar|heartland\s+mls|platinum\s+realty)\b/i
const INDUSTRY_PASSCODE = /\b(?:heartland|kcrar|mls)\b[\s\S]{0,80}\bpasscode\b|\bpasscode\b[\s\S]{0,40}\b(?:heartland|kcrar|mls)\b/i

const SELL_PHRASES: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'interested_in_selling', pattern: /\b(?:interested|intrested|intersted|interrested) in selling\b/ },
  { reason: 'want_to_sell', pattern: /\b(?:want|wanna|need|ready|looking|would like|'?d like|like) to sell\b/ },
  { reason: 'house_to_sell', pattern: /\b(?:have|got|gotten)\s+(?:a|an|another)\s+(?:house|home|property|one)\s+to\s+sell\b/ },
  { reason: 'another_to_sell', pattern: /\banother\s+(?:one|house|home|property)\s+to\s+sell\b/ },
  { reason: 'want_an_offer', pattern: /\b(?:want|need|get)\s+an\s+offer\b/ },
  { reason: 'make_an_offer', pattern: /\bmake\s+me\s+an\s+offer\b/ },
  { reason: 'what_would_you_offer', pattern: /\bwhat\s+would\s+you\s+offer\b/ },
  { reason: 'cash_offer', pattern: /\b(?:can\s+i\s+get\s+a\s+)?cash\s+offer\b/ },
  { reason: 'for_sale', pattern: /\bfor\s+sale\b/ },
]

export function isBareYesReply(message: string | null | undefined): boolean {
  if (!message) return false
  const compact = message
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/,/g, ' ')
    .replace(/[.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return compact === 'yes' || compact === 'yes please'
}

/** The missed-call "Reply YES" bodies in src/lib/missed-call-messaging.ts. Appointment "Reply YES to confirm" is not one of them. */
export function isCompanySellAutoText(body: string | null | undefined): boolean {
  if (!body) return false
  const text = body.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim()
  if (!text.includes('reply yes')) return false
  if (
    text.includes('reply yes to confirm')
    && !text.includes('looking to sell')
    && !text.includes('about selling a property')
  ) return false
  return (
    text.includes("were you looking to sell a property? reply yes and we'll call you right back")
    || text.includes('about selling a property? reply yes or call us back anytime')
    || text.includes("keep missing each other! reply yes or call back and we'll get you taken care of")
    || (text.includes("we're here! reply yes or call ") && text.includes('at saving kc anytime'))
  )
}

function displayQuote(message: string): string {
  return message.replace(/\s+/g, ' ').trim().slice(0, 180)
}

function normalizeForMatch(message: string): string {
  return message
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/(\d),(\d)/g, '$1$2')
    .replace(/[^a-z0-9$'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function isIndustryOrBulk(message: string): boolean {
  return INDUSTRY_SENDER.test(message) || INDUSTRY_PASSCODE.test(message) || classifyJunkInboundSms(message) !== null
}

function refusesToSell(text: string): boolean {
  if (/^(?:stop|stopall|unsubscribe|cancel|quit)(?:\s+please)?$/.test(text)) return true
  if (/\bwrong number\b/.test(text)) return true
  if (/\b(?:staying in|not selling|won'?t sell|will not sell)\b/.test(text)) return true
  if (/\b(?:don'?t|do not)\s+have\s+(?:a\s+)?(?:house|home|property)\b/.test(text)) return true
  if (/\bnot interested in selling\b/.test(text)) return true
  if (/\b(?:not|no|never|don'?t|do not|won'?t|wouldn'?t)\b(?:\s+\w+){0,6}\s+(?:sell|selling|for sale)\b/.test(text)) return true
  return false
}

export function hasExplicitSellingIntent(
  message: string | null | undefined,
  opts?: { priorOutbound?: string | null },
): SellingIntentResult {
  const raw = (message ?? '').trim()
  if (!raw) return { intent: false, reason: 'empty' }
  if (isIndustryOrBulk(raw)) return { intent: false, reason: 'industry_or_bulk' }
  if (isCompanySellAutoText(raw)) return { intent: false, reason: 'company_auto_text' }

  const text = normalizeForMatch(raw)
  if (!text) return { intent: false, reason: 'no_words' }
  if (refusesToSell(text)) return { intent: false, reason: 'not_selling' }

  if (isBareYesReply(raw)) {
    if (opts?.priorOutbound && isCompanySellAutoText(opts.priorOutbound)) {
      return { intent: true, quote: displayQuote(raw), reason: 'reply_yes_to_sell_auto_text' }
    }
    return { intent: false, reason: 'yes_without_sell_auto_text' }
  }

  for (const phrase of SELL_PHRASES) {
    if (phrase.pattern.test(text)) return { intent: true, quote: displayQuote(raw), reason: phrase.reason }
  }

  const hasPrice = /\$\d|\b\d{2,3}\s*k\b|\b\d{4,7}\b/.test(text)
  const hasSellWord = /\b(?:sell|selling)\b/.test(text)
  if (hasPrice && hasSellWord) return { intent: true, quote: displayQuote(raw), reason: 'asking_price_and_sell' }

  return { intent: false, reason: 'no_explicit_selling_intent' }
}

export function extractIntentQuote(
  message: string | null | undefined,
  opts?: { priorOutbound?: string | null },
): string {
  const result = hasExplicitSellingIntent(message, opts)
  return result.intent ? result.quote : ''
}
