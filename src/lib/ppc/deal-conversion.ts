import { enqueuePpcConversion } from '@/lib/ppc/conversion-outbox'
import { loadPpcLeadConversionContext } from '@/lib/ppc/lead-conversion-context'

/**
 * Contract signed and deal closed, reported back to Google Ads (G6).
 * Only leads with real paid evidence are queued (the context loader decides).
 * Like every factual event, these export with the standard value of 1, never
 * the assignment fee: true revenue stays in the CRM.
 */
export async function queuePpcDealConversion(input: {
  leadId: string
  eventName: 'contract_signed' | 'deal_closed'
  occurredAt?: string | null
  source: string
  referenceId?: string | null
}): Promise<{ queued: boolean; reason: string }> {
  const context = await loadPpcLeadConversionContext(input.leadId)
  if (!context.ok) return { queued: false, reason: context.reason }

  const result = await enqueuePpcConversion({
    eventName: input.eventName,
    eventCategory: 'deal',
    leadId: input.leadId,
    dedupeKey: `lead:${input.leadId}:${input.eventName}`,
    optimizationRole: 'secondary',
    approvedForGoogleAds: true,
    conversionValue: 1,
    eventTime: input.occurredAt || undefined,
    attribution: context.attribution,
    payload: {
      source: input.source,
      reference_id: input.referenceId ?? null,
      approval_required: false,
      google_ads_value_basis: `factual_${input.eventName}`,
      user_identifiers: context.userIdentifiers.length ? context.userIdentifiers : undefined,
    },
  })
  return result.queued ? { queued: true, reason: 'queued' } : { queued: false, reason: result.reason }
}
