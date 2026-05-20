/**
 * PPC Conversion Tracking
 *
 * Four Google Ads conversion events:
 *   lead_quiz_started     ($1)  — step 1 -> 2
 *   lead_quiz_qualified   ($5)  — step 2 -> 3
 *   lead_submitted        ($25) — primary, fires on contact submit
 *   appointment_booked    ($100) — primary, fires server-side after Cal.com webhook
 *
 * Conversion labels come from env vars so they're swappable per environment
 * without code changes:
 *   NEXT_PUBLIC_GOOGLE_ADS_ID            — AW-XXXXXXXXX
 *   NEXT_PUBLIC_GADS_LABEL_QUIZ_STARTED  — conversion label
 *   NEXT_PUBLIC_GADS_LABEL_QUIZ_QUALIFIED
 *   NEXT_PUBLIC_GADS_LABEL_LEAD_SUBMITTED
 *   NEXT_PUBLIC_GADS_LABEL_APPOINTMENT_BOOKED
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

const LABEL_ENV: Record<ConversionEvent, string> = {
  lead_quiz_started: 'NEXT_PUBLIC_GADS_LABEL_QUIZ_STARTED',
  lead_quiz_qualified: 'NEXT_PUBLIC_GADS_LABEL_QUIZ_QUALIFIED',
  lead_submitted: 'NEXT_PUBLIC_GADS_LABEL_LEAD_SUBMITTED',
  appointment_booked: 'NEXT_PUBLIC_GADS_LABEL_APPOINTMENT_BOOKED',
}

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

export function fireConversion(event: ConversionEvent): void {
  if (typeof window === 'undefined') return

  const value = CONVERSION_VALUES[event]
  const accountId =
    process.env.NEXT_PUBLIC_GOOGLE_ADS_ID ?? ''
  const label =
    process.env[LABEL_ENV[event]] ?? ''

  if (window.dataLayer) {
    window.dataLayer.push({ event, value, currency: 'USD' })
  }

  if (accountId && label && typeof window.gtag === 'function') {
    window.gtag('event', 'conversion', {
      send_to: `${accountId}/${label}`,
      value,
      currency: 'USD',
    })
  }

  if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.log('[ppc/conversions] fired', event, '$' + value)
  }
}
