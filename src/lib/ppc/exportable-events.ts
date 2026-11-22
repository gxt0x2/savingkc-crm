import type { PpcConversionEventName } from '@/lib/ppc/conversion-outbox'

export const GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES: PpcConversionEventName[] = [
  'qualified_lead',
  'appointment_booked',
  'contract_signed',
  'deal_closed',
  'call_connected_60s',
  'call_connected_2m',
  'call_connected_5m',
]

export const GOOGLE_ADS_FACTUAL_PPC_EVENT_NAMES: PpcConversionEventName[] = [
  'qualified_lead',
  'appointment_booked',
  'contract_signed',
  'deal_closed',
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

/**
 * Deal-stage conversions (G6). A missing Google Ads conversion action mapping
 * fails these loudly instead of skipping them, so the daily tracking health
 * check reports it while the clicks are still inside Google's 90-day window.
 */
export const GOOGLE_ADS_DEAL_PPC_EVENT_NAMES: PpcConversionEventName[] = ['contract_signed', 'deal_closed']

export function isGoogleAdsDealPpcEvent(eventName: string | null | undefined): boolean {
  return eventName === 'contract_signed' || eventName === 'deal_closed'
}
