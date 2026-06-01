import type { PpcConversionEventName } from '@/lib/ppc/conversion-outbox'

export const GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES: PpcConversionEventName[] = [
  'qualified_lead',
  'appointment_booked',
  'call_connected_60s',
  'call_connected_2m',
  'call_connected_5m',
]

export const GOOGLE_ADS_FACTUAL_PPC_EVENT_NAMES: PpcConversionEventName[] = [
  'qualified_lead',
  'appointment_booked',
  'call_connected_60s',
  'call_connected_2m',
  'call_connected_5m',
]

export const GOOGLE_ADS_CLEANUP_ONLY_PPC_EVENT_NAMES: PpcConversionEventName[] = [
  'lead_submitted',
]

const GOOGLE_ADS_EXPORTABLE_PPC_EVENTS = new Set<string>(GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES)
const GOOGLE_ADS_FACTUAL_PPC_EVENTS = new Set<string>(GOOGLE_ADS_FACTUAL_PPC_EVENT_NAMES)

export function isGoogleAdsExportablePpcEvent(eventName: string | null | undefined): boolean {
  return Boolean(eventName && GOOGLE_ADS_EXPORTABLE_PPC_EVENTS.has(eventName))
}

export function isGoogleAdsFactualPpcEvent(eventName: string | null | undefined): boolean {
  return Boolean(eventName && GOOGLE_ADS_FACTUAL_PPC_EVENTS.has(eventName))
}

export function isGoogleAdsApprovalRequiredPpcEvent(
  eventName: string | null | undefined,
  payload: Record<string, unknown> | null | undefined,
): boolean {
  if (!isGoogleAdsExportablePpcEvent(eventName)) return false
  return payload?.approval_required === true || payload?.approvalRequired === true
}

export function nonExportablePpcEventReason(eventName: string | null | undefined): string {
  if (eventName === 'lead_submitted') {
    return 'lead_submitted is tracked by the website/GTM primary conversion and is not eligible for offline Google Ads API export'
  }

  return `${eventName || 'conversion'} is a CRM diagnostic signal and is not eligible for Google Ads export`
}
