import { describe, expect, it } from 'vitest'

import { getPipelineIntentSource, isApprovedPipelineIntentSource } from '@/lib/pipeline-intent'

describe('pipeline intent', () => {
  it('admits approved seller-intake sources', () => {
    expect(isApprovedPipelineIntentSource('website_form')).toBe(true)
    expect(isApprovedPipelineIntentSource('ppc-landing')).toBe(true)
    expect(isApprovedPipelineIntentSource('google_ads_phone')).toBe(true)
    expect(isApprovedPipelineIntentSource('inbound_ivr')).toBe(true)
  })

  it('does not treat ordinary communication as pipeline intent', () => {
    for (const source of ['inbound_call', 'inbound_sms', 'heir_dialer', 'manual_crm', 'voicemail']) {
      expect(isApprovedPipelineIntentSource(source)).toBe(false)
      expect(getPipelineIntentSource(source)).toBeNull()
    }
  })

  it('recognizes an explicit converted outbound intent event', () => {
    expect(getPipelineIntentSource('heir_dialer', [{
      activity_type: 'status_change',
      metadata: { action: 'pipeline_intent', intent_source: 'converted_outbound_sms' },
    }])).toBe('converted_outbound_sms')
  })

  it('recognizes seller intent selected in the IVR without admitting every call', () => {
    expect(getPipelineIntentSource('inbound_call', [{
      activity_type: 'call',
      metadata: { source: 'ivr_press_1' },
    }])).toBe('ivr_press_1')
    expect(getPipelineIntentSource('inbound_call', [{
      activity_type: 'call',
      metadata: { source: 'generic_inbound_call' },
    }])).toBeNull()
  })
})
