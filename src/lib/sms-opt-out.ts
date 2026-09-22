import { supabase } from '@/lib/supabase-lazy'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/**
 * TCPA Opt-Out Compliance
 * Handles STOP/START keyword processing and opt-out state management
 */





const EXACT_STOP_REASONS: Record<string, string> = {
  stop: 'STOP',
  unsubscribe: 'UNSUBSCRIBE',
  cancel: 'CANCEL',
  end: 'END',
  quit: 'QUIT',
  stopall: 'STOPALL',
  'stop all': 'STOPALL',
}

/**
 * High-precision opt-out matcher for TCPA/CTIA "reasonable means" of revocation.
 *
 * Exact carrier keywords match only when the whole message is that keyword.
 * Trailing punctuation is ignored ("STOP."). "please stop" is natural language,
 * not the carrier keyword. Natural language is a separate allowlist: unsubscribe,
 * opt out, take-me-off, DND/DNC, and explicit "stop texting / do not call /
 * do not contact" phrases. It does not fuzzy-match.
 * Negated requests ("don't unsubscribe", "never stop texting") and temporary
 * call deferrals ("don't call until Thursday") are not opt-outs. "Cancel the
 * appointment" is not an opt-out; bare CANCEL still is, because carriers treat
 * that single keyword as STOP. Messages longer than 400 characters are not
 * natural-language matched, so a forwarded thread cannot trip the matcher.
 */
const NATURAL_LANGUAGE_LIMIT = 400

const BARE_OPT_OUT = /^(please\s+)?(stop|stop all|stopall|unsubscribe|opt out|dnd|dnc|do not disturb)(\s+please)?$/
const DIRECT_CONTACT_REFUSAL = /\b(?:do not|don't|dont|never)\s+(?:\w+\s+){0,2}(?:text|texting|texts|call|calling|calls|contact|contacting|message|messaging)\b|\b(?:stop|quit)\s+(?:all\s+)?(?:texting|texts|calling|calls|contacting|messaging|messages)\b|\bstop\s+(?:all\s+)?(?:text|texts|messages|calls|contact)\b|\bno more\s+(?:texts|text messages|messages|calls|contact)\b|\btake me off\b|\bremove my number\b|\bdelete my number\b/
const NEGATED_OPT_OUT = /\b(?:do not|don't|dont|never)\b(?:\s+\w+){0,4}\s+(?:stop|unsubscribe|opt out|remove me|take me off)\b|\b(?:never|do not|don't|dont)\s+stop\s+(?:texting|calling|messaging|contacting)\b/
const CALL_DEFERRAL = /\b(?:until|till|after|tomorrow|next week|next month|another time|call me back)\b/
const OPT_OUT_PHRASES = [
  /\b(?:unsubscribe|opt out)\b/,
  /\btake me off\b/,
  /\bremove my number\b/,
  /\bdelete my number\b/,
  /\bremove me\b(?:\s+\w+){0,4}\s+(?:list|texts|text|messages|contacts|calling)\b/,
  /^remove me(?:\s+please)?$/,
  /\bleave me alone\b/,
  /\bdo not disturb\b/,
  /\b(?:put|place) me on (?:the )?(?:dnc|dnd|do not call)\b/,
  /\b(?:this is|i am on) (?:a )?(?:dnc|dnd|do not call)\b/,
  /\bend\s+(?:the\s+|all\s+)?(?:texts|texting|messages|calls)\b/,
  DIRECT_CONTACT_REFUSAL,
]

export type SmsOptOutReason =
  | 'STOP'
  | 'UNSUBSCRIBE'
  | 'CANCEL'
  | 'END'
  | 'QUIT'
  | 'STOPALL'
  | 'NATURAL_LANGUAGE_OPT_OUT'

export interface SmsOptOutClassification {
  reason: SmsOptOutReason
}

function canonicalPhone(phone: string): string {
  return normalizePhoneToE164(phone) ?? phone.trim()
}

export function normalizeSmsOptOutText(text: string): string {
  return text
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

export function isStopKeyword(text: string): boolean {
  return EXACT_STOP_REASONS[normalizeSmsOptOutText(text)] !== undefined
}

export function isStartKeyword(text: string): boolean {
  const normalized = normalizeSmsOptOutText(text)
  return normalized === 'start' || normalized === 'unstop'
}

function isTemporaryCallDeferral(normalized: string): boolean {
  const refusesCall = /\b(?:do not|don't|dont|never)\s+(?:\w+\s+){0,2}(?:call|calling|calls)\b/.test(normalized)
  const refusesMoreThanCalls = /\b(?:text|texting|texts|sms|message|messages|contact|unsubscribe|opt out|take me off|remove me|dnc|dnd|do not disturb)\b/.test(normalized)
  return refusesCall && CALL_DEFERRAL.test(normalized) && !refusesMoreThanCalls
}

export function isNaturalLanguageOptOut(text: string): boolean {
  const raw = text.trim()
  if (!raw || raw.length > NATURAL_LANGUAGE_LIMIT) return false
  const normalized = normalizeSmsOptOutText(raw)
  if (!normalized || isStopKeyword(raw)) return false
  if (BARE_OPT_OUT.test(normalized)) return true
  if (isTemporaryCallDeferral(normalized)) return false
  if (NEGATED_OPT_OUT.test(normalized) && !DIRECT_CONTACT_REFUSAL.test(normalized)) return false
  if (/\b(?:never|do not|don't|dont)\s+stop\s+(?:texting|calling|messaging|contacting)\b/.test(normalized)) return false
  return OPT_OUT_PHRASES.some((pattern) => pattern.test(normalized))
}

export function classifySmsOptOut(text: string): SmsOptOutClassification | null {
  const exact = EXACT_STOP_REASONS[normalizeSmsOptOutText(text)]
  if (exact) return { reason: exact as SmsOptOutReason }
  if (isNaturalLanguageOptOut(text)) return { reason: 'NATURAL_LANGUAGE_OPT_OUT' }
  return null
}

export function isSmsOptOutMessage(text: string): boolean {
  return classifySmsOptOut(text) !== null
}

/**
 * Check if a phone number is opted out
 */
export async function isOptedOut(phone: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('sms_opt_outs')
    .select('is_opted_out')
    .eq('phone', canonicalPhone(phone))
    .eq('is_opted_out', true)
    .maybeSingle()

  if (error) throw new Error('SMS suppression status could not be verified')

  return !!data
}

/**
 * Handle an opt-out request (STOP keyword)
 */
export async function handleOptOut(phone: string, keyword: string): Promise<void> {
  const { error } = await supabase
    .from('sms_opt_outs')
    .upsert(
      {
        phone: canonicalPhone(phone),
        is_opted_out: true,
        opted_out_at: new Date().toISOString(),
        reason: keyword.toUpperCase(),
      },
      { onConflict: 'phone' }
    )

  if (error) throw new Error('SMS opt-out could not be saved')
}

/**
 * Handle an opt-in request (START keyword)
 */
export async function handleOptIn(phone: string): Promise<void> {
  const { error } = await supabase
    .from('sms_opt_outs')
    .upsert(
      {
        phone: canonicalPhone(phone),
        is_opted_out: false,
        opted_in_at: new Date().toISOString(),
        reason: null,
      },
      { onConflict: 'phone' }
    )

  if (error) throw new Error('SMS opt-in could not be saved')
}
