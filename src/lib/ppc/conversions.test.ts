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

  it('mirrors OpenAI Ads standard conversion events with stable dedupe ids', () => {
    const oaiq = vi.fn()
    vi.stubGlobal('window', { dataLayer: [], oaiq })

    fireConversion('lead_submitted', {
      event_id: 'lead:123:lead_submitted',
      form_step: 4,
      form_status: 'submitted',
      form_submitted: true,
    })

    expect(oaiq).toHaveBeenCalledWith(
      'measure',
      'lead_created',
      { type: 'customer_action' },
      { event_id: 'lead:123:lead_submitted' },
    )
  })

  it('suppresses browser conversion tags on smoke-test URLs', () => {
    const oaiq = vi.fn()
    vi.stubGlobal('window', {
      dataLayer: [],
      oaiq,
      location: {
        pathname: '/ppc',
        href: 'https://savingkc.com/ppc?utm_source=openai_ads&utm_medium=smoke_test&utm_campaign=openai_ads_smoke&skc_test=1',
        search: '?utm_source=openai_ads&utm_medium=smoke_test&utm_campaign=openai_ads_smoke&skc_test=1',
      },
      navigator: {},
    })

    const event = fireConversion('lead_submitted', {
      event_id: 'codex_smoke_lead:123:lead_submitted',
      form_step: 4,
      form_status: 'submitted',
      form_submitted: true,
    })

    expect(event).toMatchObject({
      event: 'lead_submitted',
      conversion_value: 25,
      optimization_role: 'primary',
    })
    expect(currentDataLayer()).toEqual([])
    expect(oaiq).not.toHaveBeenCalled()
  })

  it('adds page context for the tax PPC landing page', () => {
    vi.stubGlobal('window', {
      dataLayer: [],
      oaiq: vi.fn(),
      location: {
        pathname: '/ppc-tax',
        href: 'https://crm.savingkc.com/ppc-tax?gclid=test-click',
      },
    })

    const event = firePpcTrackingEvent('ppc_visit_started')

    expect(event).toMatchObject({
      event: 'ppc_visit_started',
      campaign: 'Search - Property Tax',
      page_path: '/ppc-tax',
      page_location: 'https://crm.savingkc.com/ppc-tax?gclid=test-click',
      page_variant: 'ppc_tax',
    })
    expect((globalThis.window as unknown as { oaiq: ReturnType<typeof vi.fn> }).oaiq).toHaveBeenCalledWith(
      'measure',
      'page_viewed',
      expect.objectContaining({ type: 'contents' }),
      { event_id: event?.event_id },
    )
  })

  it('tracks stage 3 completion as a diagnostic field-completion signal', () => {
    const event = firePpcTrackingEvent('step_3_field_completed', {
      form_step: 3,
      form_status: 'stage_3_complete_no_submit',
      form_submitted: false,
      has_address: true,
    })

    expect(event).toMatchObject({
      event: 'step_3_field_completed',
      form_status: 'stage_3_complete_no_submit',
      form_submitted: false,
    })
    expect(event).not.toHaveProperty('conversion_value')
    expect(event).not.toHaveProperty('optimization_role')
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

  it('allows specific landing-page heatmap events without conversion value', () => {
    const showMe = firePpcTrackingEvent('show_me_clicked', {
      item_id: 'ppc_general__problems__back_taxes',
      item_label: 'Tax letters keep coming',
      section: 'problems',
      position: 1,
    })
    const video = firePpcTrackingEvent('video_progress_50', {
      video_id: 'seller-story',
      video_title: 'Seller story',
      section: 'video-testimonials',
      watch_percent: 54,
    })

    expect(showMe).toMatchObject({
      event: 'show_me_clicked',
      item_id: 'ppc_general__problems__back_taxes',
      item_label: 'Tax letters keep coming',
    })
    expect(showMe).not.toHaveProperty('conversion_value')
    expect(video).toMatchObject({
      event: 'video_progress_50',
      video_id: 'seller-story',
      watch_percent: 54,
    })
    expect(video).not.toHaveProperty('optimization_role')
  })

  it('does not throw during server-side rendering', () => {
    vi.unstubAllGlobals()

    expect(firePpcTrackingEvent('situation_selected')).toBeNull()
    expect(fireConversion('lead_submitted')).toBeNull()
  })
})
