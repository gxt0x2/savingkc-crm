/**
 * PPC dataLayer events. Web GTM owns the GA4/Google Ads tags.
 *
 * Keep raw PII out of browser analytics payloads. The CRM/API receives contact
 * details; GA4 gets funnel facts such as selected options and completion state.
 */

import { sendPpcTrackingEvent } from '@/lib/ppc/tracking-client'
import { getAttribution } from '@/lib/ppc/attribution'
import { ppcCampaignNameForContext, ppcPageVariantForPath } from '@/lib/ppc/campaigns'
import { sendOpenAIAdsPixelEvent } from '@/lib/ppc/openai-ads-client'

export type ConversionEvent =
  | 'lead_quiz_started'
  | 'lead_quiz_qualified'
  | 'lead_stage3_completed'
  | 'lead_submitted'
  | 'appointment_booked'

export type PpcMicroEvent =
  | 'ppc_visit_started'
  | 'skc_phone_number_selected'
  | 'phone_click'
  | 'situation_selected'
  | 'timeline_selected'
  | 'condition_selected'
  | 'auction_status_selected'
  | 'address_selected'
  | 'contact_field_started'
  | 'form_step_completed'
  | 'form_error'
  | 'step_3_field_completed'
  | 'section_viewed'
  | 'scroll_depth_reached'
  | 'cta_click'
  | 'nav_click'
  | 'faq_opened'
  | 'show_me_clicked'
  | 'video_started'
  | 'video_play'
  | 'video_progress_25'
  | 'video_progress_50'
  | 'video_progress_75'
  | 'video_completed'
  | 'video_paused'

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

const TEST_MARKER_RE = /(^|[^a-z0-9])(codex|test|dummy|probe|smoke)([^a-z0-9]|$)/i

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

function isServerRecorded(event: PpcTrackingEvent): boolean {
  return event === 'lead_submitted' || event === 'appointment_booked'
}

function isConversionEvent(event: PpcTrackingEvent): event is ConversionEvent {
  return event in CONVERSION_VALUES
}

function isSmokeTestMode(
  attribution: ReturnType<typeof safeAttribution>,
  pageContext: Record<string, unknown>,
  payload: Record<string, unknown>,
): boolean {
  if (typeof window === 'undefined') return false

  const search = window.location?.search ?? ''
  const params = new URLSearchParams(search)
  if (params.get('skc_test') === '1' || params.get('skc_test') === 'true') return true

  const values = [
    window.location?.href,
    pageContext.page_location,
    payload.event_id,
    payload.test_id,
    attribution?.landingUrl,
    attribution?.utm_source,
    attribution?.utm_medium,
    attribution?.utm_campaign,
    attribution?.utm_content,
    attribution?.gclid,
    attribution?.gbraid,
    attribution?.wbraid,
    attribution?.oppref,
  ]

  return values.some((value) => typeof value === 'string' && TEST_MARKER_RE.test(value))
}

function safeAttribution() {
  try {
    return getAttribution()
  } catch {
    return null
  }
}

function currentPageContext(): Record<string, unknown> {
  if (typeof window === 'undefined') return {}

  const pagePath = window.location?.pathname
  if (!pagePath) return {}

  return {
    page_path: pagePath,
    page_location: window.location?.href,
    page_variant: ppcPageVariantForPath(pagePath),
  }
}

export function firePpcTrackingEvent(
  event: PpcTrackingEvent,
  payload: Record<string, unknown> = {},
): Record<string, unknown> | null {
  if (typeof window === 'undefined') return null

  const pageContext = currentPageContext()
  const attribution = safeAttribution()
  const dataLayerEvent = cleanPayload({
    event,
    event_id: makeEventId(event),
    event_time: new Date().toISOString(),
    traffic_source: 'google_ads',
    campaign: ppcCampaignNameForContext({
      attribution: attribution ? { ...attribution } : null,
      pagePath: pageContext.page_path,
      pageLocation: pageContext.page_location,
    }),
    ...pageContext,
    ...payload,
  })

  window.dataLayer = window.dataLayer || []
  const suppressBrowserConversion = isConversionEvent(event) && isSmokeTestMode(attribution, pageContext, payload)

  if (!suppressBrowserConversion) {
    window.dataLayer.push(dataLayerEvent)
    sendOpenAIAdsPixelEvent(dataLayerEvent)
  }

  if (!isServerRecorded(event)) sendPpcTrackingEvent(dataLayerEvent)

  if (process.env.NODE_ENV !== 'production') {
    console.log('[ppc/conversions] fired', event, suppressBrowserConversion ? '(browser conversion suppressed)' : '')
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
