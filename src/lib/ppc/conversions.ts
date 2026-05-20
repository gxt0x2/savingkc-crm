/**
 * PPC Conversion Tracking
 *
 * Four dataLayer conversion events. Web GTM owns the Google Ads/GA4 tags:
 *   lead_quiz_started     ($1)  — step 1 -> 2
 *   lead_quiz_qualified   ($5)  — step 2 -> 3
 *   lead_submitted        ($25) — primary, fires on contact submit
 *   appointment_booked    ($100) — primary, fires server-side after Cal.com webhook
 */

export type ConversionEvent =
  | 'lead_quiz_started'
  | 'lead_quiz_qualified'
  | 'lead_submitted'
  | 'appointment_booked'

export const CONVERSION_VALUES: Record<ConversionEvent, number> = {
  lead_quiz_started: 1,
  lead_quiz_qualified: 5,
  lead_submitted: 25,
  appointment_booked: 100,
}

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
  }
}

function makeEventId(event: ConversionEvent): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `skc_${event}_${Date.now()}_${rand}`
}

export function fireConversion(event: ConversionEvent): void {
  if (typeof window === 'undefined') return

  const value = CONVERSION_VALUES[event]

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push({
    event,
    event_id: makeEventId(event),
    conversion_value: value,
    value,
    currency: 'USD',
    traffic_source: 'google_ads',
  })

  if (process.env.NODE_ENV !== 'production') {
    console.log('[ppc/conversions] fired', event, '$' + value)
  }
}
