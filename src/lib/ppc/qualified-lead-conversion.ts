import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { loadPpcLeadConversionContext } from '@/lib/ppc/lead-conversion-context'

const QUALIFIED_OR_BETTER_STATIONS = new Set([
  'qualified',
  'appointment',
  'appt_set',
  'appointment_set',
  'offer',
  'offer_made',
  'offer_presented',
  'negotiating',
  'negotiations',
  'contract',
  'contract_signed',
  'under_contract',
  'inspection',
  'closing_prep',
  'closing',
  'closed',
  'closed_won',
])

export type QueuePpcQualifiedLeadConversionResult =
  | { queued: true; reason: 'queued' }
  | { queued: false; reason: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isQualifiedOrBetterStation(station: string | null | undefined): boolean {
  return QUALIFIED_OR_BETTER_STATIONS.has(text(station).toLowerCase())
}

export async function queuePpcQualifiedLeadConversion(input: {
  leadId: string
  toStation: string | null | undefined
  fromStation?: string | null
  changedBy?: string | null
  reason?: string | null
}): Promise<QueuePpcQualifiedLeadConversionResult> {
  if (!isQualifiedOrBetterStation(input.toStation)) {
    return { queued: false, reason: 'station_not_qualified' }
  }

  const context = await loadPpcLeadConversionContext(input.leadId)
  if (!context.ok) return { queued: false, reason: context.reason }

  const queued = await enqueuePpcConversion({
    eventName: 'qualified_lead',
    eventCategory: 'form',
    leadId: input.leadId,
    manifestId: context.manifestId,
    dedupeKey: `lead:${input.leadId}:qualified_lead`,
    optimizationRole: 'primary',
    approvedForGoogleAds: true,
    conversionValue: 1,
    attribution: context.attribution,
    payload: {
      source: 'crm_qualified_stage',
      form_status: 'qualified_lead',
      lead_stage: input.toStation ?? null,
      previous_stage: input.fromStation ?? null,
      changed_by: input.changedBy ?? null,
      reason: input.reason ?? null,
      approval_required: false,
      google_ads_value_basis: 'factual_stage_conversion',
      user_identifiers: context.userIdentifiers.length ? context.userIdentifiers : undefined,
    },
  })

  return queued.queued
    ? { queued: true, reason: 'queued' }
    : { queued: false, reason: queued.reason }
}
