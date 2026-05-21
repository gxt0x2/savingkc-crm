/**
 * PPC dataLayer events. Web GTM owns the GA4/Google Ads tags.
 *
 * Keep raw PII out of browser analytics payloads. The CRM/API receives contact
 * details; GA4 gets funnel facts such as selected options and completion state.
 */

export type ConversionEvent =
  | 'lead_quiz_started'
  | 'lead_quiz_qualified'
  | 'lead_stage3_completed'
  | 'lead_submitted'
  | 'appointment_booked'

export type PpcMicroEvent =
  | 'skc_phone_number_selected'
  | 'phone_click'
  | 'situation_selected'
  | 'timeline_selected'
  | 'condition_selected'
  | 'address_selected'
  | 'form_error'
  | 'step_3_field_completed'

export type PpcTrackingEvent = ConversionEvent | PpcMicroEvent

type OptimizationRole = 'primary' | 'secondary' | 'diagnostic'

export const CONVERSION_VALUES: Record<ConversionEvent, number> = {
  lead_quiz_started: 1,
  lead_quiz_qualified: 5,
  lead_stage3_completed: 10,
  lead_submitted: 25,
  appointment_booked: 100,
}

export const CONVERSION_OPTIMIZATION_ROLES: Record<ConversionEvent, OptimizationRole> = {
  lead_quiz_started: 'diagnostic',
  lead_quiz_qualified: 'secondary',
  lead_stage3_completed: 'secondary',
  lead_submitted: 'primary',
  appointment_booked: 'primary',
}

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>
  }
}

function makeEventId(event: PpcTrackingEvent): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2)
  return `skc_${event}_${Date.now()}_${rand}`
}

function cleanPayload(payload: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(payload).filter(([, value]) => value !== undefined))
}

export function firePpcTrackingEvent(
  event: PpcTrackingEvent,
  payload: Record<string, unknown> = {},
): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null

  const dataLayerEvent = cleanPayload({
    event,
    event_id: makeEventId(event),
    event_time: new Date().toISOString(),
    traffic_source: 'google_ads',
    campaign: 'Search 2026',
    ...payload,
  })

  window.dataLayer = window.dataLayer || []
  window.dataLayer.push(dataLayerEvent)

  if (process.env.NODE_ENV !== 'production') {
    console.log('[ppc/conversions] fired', event)
  }

  return dataLayerEvent
}

export function fireConversion(
  event: ConversionEvent,
  payload: Record<string, unknown> = {},
): Record<string, unknown> | null {
  const value = CONVERSION_VALUES[event]

  return firePpcTrackingEvent(event, {
    ...payload,
    conversion_value: value,
    value,
    currency: 'USD',
    optimization_role: CONVERSION_OPTIMIZATION_ROLES[event],
  })
}

export function fireFormError(
  errorMessage: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> | null {
  return firePpcTrackingEvent('form_error', {
    ...payload,
    error_message: errorMessage,
  })
}
