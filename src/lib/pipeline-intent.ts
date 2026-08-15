export const PIPELINE_INTENT_ACTIVITY_ACTION = 'pipeline_intent'

const APPROVED_PIPELINE_INTENT_SOURCES = new Set([
  'website_form',
  'website_form_submit',
  'web_form',
  'seller_form',
  'ppc_landing',
  'google_ads',
  'google_ads_phone',
  'google_ads_tax_phone',
  'google_ads_general_phone',
  'google_ads_property_tax_phone',
  'youtube',
  'inbound_ivr',
  'cold_call_callback',
])

function normalizeSource(value: unknown): string {
  return typeof value === 'string'
    ? value.trim().toLowerCase().replace(/[\s-]+/g, '_')
    : ''
}

export function isApprovedPipelineIntentSource(source: unknown): boolean {
  return APPROVED_PIPELINE_INTENT_SOURCES.has(normalizeSource(source))
}

export function getPipelineIntentSource(
  leadSource: unknown,
  activities: Array<{ activity_type?: unknown; metadata?: unknown }> = [],
): string | null {
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    const metadata = activity.metadata && typeof activity.metadata === 'object'
      ? activity.metadata as Record<string, unknown>
      : {}
    const action = normalizeSource(metadata.action)
    const source = normalizeSource(metadata.intent_source ?? metadata.source)
    if (action === PIPELINE_INTENT_ACTIVITY_ACTION && source) return source
    if (activity.activity_type === 'call' && (source === 'ivr_press_1' || source === 'cold_callback_press_1')) {
      return source
    }
  }

  return isApprovedPipelineIntentSource(leadSource) ? normalizeSource(leadSource) : null
}

export function pipelineIntentActivity(source: string, detail?: Record<string, unknown>) {
  return {
    activity_type: 'status_change',
    description: 'Seller inquiry added to New pipeline review',
    agent: 'System',
    metadata: {
      action: PIPELINE_INTENT_ACTIVITY_ACTION,
      intent_source: normalizeSource(source),
      ...detail,
    },
  }
}
