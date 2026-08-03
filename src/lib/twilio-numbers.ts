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
  { label: '(816) 608-8770', value: '+18166088770', purpose: 'general', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8808 - Google Ads: Search 2026', value: GOOGLE_ADS_TWILIO_NUMBER, purpose: 'google_ads', smsEligible: true, conversationEligible: false, broadcastEligible: false, dialerEligible: false, reservedFor: 'google_ads' },
  { label: '(816) 608-8552', value: '+18166088552', purpose: 'general', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8559', value: '+18166088559', purpose: 'general', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-6699', value: '+18166086699', purpose: 'general', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 310-0845', value: '+18163100845', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 253-8313', value: '+18162538313', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 476-1589', value: '+18164761589', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 640-4701', value: '+18166404701', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 578-8107', value: '+18165788107', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 640-8032', value: '+18166408032', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 653-6616', value: '+18166536616', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-6648 - Google Ads: Property Tax', value: GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER, purpose: 'google_ads', smsEligible: true, conversationEligible: false, broadcastEligible: false, dialerEligible: false, reservedFor: 'google_ads' },
  { label: '(816) 608-6999', value: '+18166086999', purpose: 'general', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8588 - Ernest Company', value: '+18166088588', purpose: 'company', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 476-1344', value: '+18164761344', purpose: 'cold_call', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 727-7667 - Casey Company', value: '+18167277667', purpose: 'company', smsEligible: true, conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 375-4666 - Casey Legacy', value: '+18163754666', purpose: 'company', smsEligible: true, conversationEligible: true, broadcastEligible: false, dialerEligible: false },
] as const satisfies readonly TwilioNumberConfig[]

export const CONVERSATION_TWILIO_NUMBERS = TWILIO_NUMBERS.filter((number) => number.conversationEligible)
export const BROADCAST_TWILIO_NUMBERS = TWILIO_NUMBERS.filter((number) => number.broadcastEligible)
export const DIALER_CALLER_ID_NUMBERS = TWILIO_NUMBERS.filter((number) => number.dialerEligible)

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

export function isReservedTwilioNumber(value: string | null | undefined): boolean {
  return Boolean(value && TWILIO_NUMBERS.some((number) => (
    number.value === value &&
    'reservedFor' in number &&
    Boolean(number.reservedFor)
  )))
}
