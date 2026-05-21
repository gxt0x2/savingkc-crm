import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireConversion, fireFormError, firePpcTrackingEvent } from './conversions'

function currentDataLayer() {
  return (globalThis.window as unknown as { dataLayer: Array<Record<string, unknown>> }).dataLayer
}

describe('ppc browser tracking', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { dataLayer: [] })
    vi.spyOn(console, 'log').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('pushes GA4 micro-events with Search 2026 attribution', () => {
    const event = firePpcTrackingEvent('situation_selected', {
      form_step: 1,
      situation: 'tax-delinquent',
      ignored: undefined,
    })

    expect(event).toMatchObject({
      event: 'situation_selected',
      traffic_source: 'google_ads',
      campaign: 'Search 2026',
      form_step: 1,
      situation: 'tax-delinquent',
    })
    expect(event?.event_id).toMatch(/^skc_situation_selected_/)
    expect(event?.event_time).toEqual(expect.any(String))
    expect(event).not.toHaveProperty('ignored')
    expect(currentDataLayer()).toEqual([event])
  })

  it('marks final lead submit as the primary conversion', () => {
    const event = fireConversion('lead_submitted', {
      form_step: 3,
      form_status: 'submitted',
      form_submitted: true,
    })

    expect(event).toMatchObject({
      event: 'lead_submitted',
      conversion_value: 25,
      value: 25,
      currency: 'USD',
      optimization_role: 'primary',
      form_step: 3,
      form_submitted: true,
    })
  })

  it('marks stage 3 completion as secondary and separate from final submit', () => {
    const event = fireConversion('lead_stage3_completed', {
      form_step: 3,
      form_status: 'stage_3_complete_no_submit',
      form_submitted: false,
      has_address: true,
    })

    expect(event).toMatchObject({
      event: 'lead_stage3_completed',
      conversion_value: 10,
      value: 10,
      currency: 'USD',
      optimization_role: 'secondary',
      form_status: 'stage_3_complete_no_submit',
      form_submitted: false,
    })
  })

  it('tracks validation errors as diagnostic form_error events', () => {
    const event = fireFormError('Pick a situation to continue.', {
      form_step: 1,
      field: 'situation',
    })

    expect(event).toMatchObject({
      event: 'form_error',
      error_message: 'Pick a situation to continue.',
      form_step: 1,
      field: 'situation',
    })
  })

  it('does not throw during server-side rendering', () => {
    vi.unstubAllGlobals()

    expect(firePpcTrackingEvent('situation_selected')).toBeNull()
    expect(fireConversion('lead_submitted')).toBeNull()
  })
})
