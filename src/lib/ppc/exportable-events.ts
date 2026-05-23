import type { PpcConversionEventName } from '@/lib/ppc/conversion-outbox'

export const GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES: PpcConversionEventName[] = [
  'lead_submitted',
  'qualified_lead',
  'appointment_booked',
  'call_connected_60s',
  'call_connected_2m',
  'call_connected_5m',
]

const GOOGLE_ADS_EXPORTABLE_PPC_EVENTS = new Set<string>(GOOGLE_ADS_EXPORTABLE_PPC_EVENT_NAMES)

export function isGoogleAdsExportablePpcEvent(eventName: string | null | undefined): boolean {
  return Boolean(eventName && GOOGLE_ADS_EXPORTABLE_PPC_EVENTS.has(eventName))
}

export function nonExportablePpcEventReason(eventName: string | null | undefined): string {
  return `${eventName || 'conversion'} is a CRM diagnostic signal and is not eligible for Google Ads export`
}
