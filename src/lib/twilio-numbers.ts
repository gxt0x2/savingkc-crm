export type TwilioNumberPurpose =
  | 'main'
  | 'business'
  | 'company'
  | 'cold_call'
  | 'dispositions'
  | 'google_ads'
  | 'general'

export interface TwilioNumberConfig {
  label: string
  value: string
  purpose: TwilioNumberPurpose
  smsEligible: boolean
  conversationEligible: boolean
  broadcastEligible: boolean
  dialerEligible: boolean
  reservedFor?: 'google_ads'
}

export const GOOGLE_ADS_TWILIO_NUMBER = '+18166088808'
export const GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER = '+18166086648'
export const DISPOSITIONS_TWILIO_NUMBER = '+18166088858'

export const TWILIO_NUMBERS = [
  { label: '(816) 307-7835 - Main', value: '+18163077835', purpose: 'main', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 429-2900 - SKC Business', value: '+18164292900', purpose: 'business', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8858 - Dispositions', value: DISPOSITIONS_TWILIO_NUMBER, purpose: 'dispositions', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8770 - Prospecting', value: '+18166088770', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8808 - Google Ads: Search 2026', value: GOOGLE_ADS_TWILIO_NUMBER, purpose: 'google_ads', smsEligible: true, conversationEligible: false, broadcastEligible: false, dialerEligible: false, reservedFor: 'google_ads' },
  { label: '(816) 608-8552 - Prospecting', value: '+18166088552', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8559 - Prospecting', value: '+18166088559', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  // Gertha Dotson (Admin/TC). Excluded from cold/prospecting rotation.
  // Purpose stays general so inbound remains the seller IVR, not cold Press-1.
  { label: '(816) 608-6699 - Gertha Dotson (Admin/TC)', value: '+18166086699', purpose: 'general', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: false },
  { label: '(816) 608-6648 - Google Ads: Property Tax', value: GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER, purpose: 'google_ads', smsEligible: true, conversationEligible: false, broadcastEligible: false, dialerEligible: false, reservedFor: 'google_ads' },
  { label: '(816) 608-6999 - Prospecting', value: '+18166086999', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8588 - Ernest Company', value: '+18166088588', purpose: 'company', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 727-7667 - Casey Company', value: '+18167277667', purpose: 'company', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 375-4666 - Casey Legacy', value: '+18163754666', purpose: 'company', smsEligible: true, conversationEligible: true, broadcastEligible: false, dialerEligible: false },
] as const satisfies readonly TwilioNumberConfig[]

export const CONVERSATION_TWILIO_NUMBERS = TWILIO_NUMBERS.filter((number) => number.conversationEligible)
export const BROADCAST_TWILIO_NUMBERS = TWILIO_NUMBERS.filter((number) => number.broadcastEligible)
export const DIALER_CALLER_ID_NUMBERS = TWILIO_NUMBERS.filter((number) => number.dialerEligible)
export const COLD_CALL_DIALER_NUMBERS = TWILIO_NUMBERS.filter((number) => (
  number.purpose === 'cold_call' && number.dialerEligible
))
/** Cold-callback DIDs. Inbound Press-1 uses this set. */
export const COLD_CALL_CALLBACK_NUMBERS = TWILIO_NUMBERS.filter((number) => number.purpose === 'cold_call')

export type SmsSenderUse = 'conversation' | 'broadcast' | 'reply' | 'system'

export function normalizeTwilioNumber(value: string | null | undefined): string | null {
  const digits = (value || '').replace(/\D/g, '')
  if (digits.length === 10) return `+1${digits}`
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`
  return null
}

export function findTwilioNumber(value: string | null | undefined) {
  const normalized = normalizeTwilioNumber(value)
  return TWILIO_NUMBERS.find((number) => number.value === normalized)
}

/**
 * Server and client surfaces share this policy so a selected communication
 * identity cannot silently cross into a protected or ineligible workflow.
 */
export function isAllowedSmsSender(value: string | null | undefined, use: SmsSenderUse): boolean {
  const config = findTwilioNumber(value)
  if (!config?.smsEligible) return false
  if (use === 'conversation') return config.conversationEligible
  if (use === 'broadcast') return config.broadcastEligible
  if (use === 'reply') return true
  return !('reservedFor' in config && Boolean(config.reservedFor))
}

export function isDialerCallerIdNumber(value: string | null | undefined): boolean {
  return Boolean(value && DIALER_CALLER_ID_NUMBERS.some((number) => number.value === value))
}

export function isColdCallDialerNumber(value: string | null | undefined): boolean {
  return Boolean(value && COLD_CALL_DIALER_NUMBERS.some((number) => number.value === value))
}

export function isColdCallCallbackNumber(value: string | null | undefined): boolean {
  return Boolean(value && COLD_CALL_CALLBACK_NUMBERS.some((number) => number.value === value))
}

export function isReservedTwilioNumber(value: string | null | undefined): boolean {
  return Boolean(value && TWILIO_NUMBERS.some((number) => (
    number.value === value &&
    'reservedFor' in number &&
    Boolean(number.reservedFor)
  )))
}
