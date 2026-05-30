export type TwilioNumberPurpose =
  | 'main'
  | 'business'
  | 'company'
  | 'cold_call'
  | 'google_ads'
  | 'general'

export interface TwilioNumberConfig {
  label: string
  value: string
  purpose: TwilioNumberPurpose
  conversationEligible: boolean
  broadcastEligible: boolean
  dialerEligible: boolean
  reservedFor?: 'google_ads'
}

export const GOOGLE_ADS_TWILIO_NUMBER = '+18166088808'
export const GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER = '+18166086648'

export const TWILIO_NUMBERS = [
  { label: '(816) 307-7835 - Main', value: '+18163077835', purpose: 'main', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 429-2900 - SKC Business', value: '+18164292900', purpose: 'business', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8858', value: '+18166088858', purpose: 'general', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8770', value: '+18166088770', purpose: 'general', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8808 - Google Ads: Search 2026', value: GOOGLE_ADS_TWILIO_NUMBER, purpose: 'google_ads', conversationEligible: false, broadcastEligible: false, dialerEligible: false, reservedFor: 'google_ads' },
  { label: '(816) 608-8552', value: '+18166088552', purpose: 'general', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8559', value: '+18166088559', purpose: 'general', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-6699', value: '+18166086699', purpose: 'general', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 310-0845', value: '+18163100845', purpose: 'cold_call', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 640-4701', value: '+18166404701', purpose: 'cold_call', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-6648 - Google Ads: Property Tax', value: GOOGLE_ADS_PROPERTY_TAX_TWILIO_NUMBER, purpose: 'google_ads', conversationEligible: false, broadcastEligible: false, dialerEligible: false, reservedFor: 'google_ads' },
  { label: '(816) 608-6999', value: '+18166086999', purpose: 'general', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 608-8588 - Ernest Company', value: '+18166088588', purpose: 'company', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 476-1344', value: '+18164761344', purpose: 'cold_call', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
  { label: '(816) 727-7667 - Casey Company', value: '+18167277667', purpose: 'company', conversationEligible: true, broadcastEligible: true, dialerEligible: true },
] as const satisfies readonly TwilioNumberConfig[]

export const CONVERSATION_TWILIO_NUMBERS = TWILIO_NUMBERS.filter((number) => number.conversationEligible)
export const BROADCAST_TWILIO_NUMBERS = TWILIO_NUMBERS.filter((number) => number.broadcastEligible)
export const DIALER_CALLER_ID_NUMBERS = TWILIO_NUMBERS.filter((number) => number.dialerEligible)

export function findTwilioNumber(value: string | null | undefined) {
  return TWILIO_NUMBERS.find((number) => number.value === value)
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
