import { describe, expect, it } from 'vitest'
import { hasLeadSignal, isBotOnlyPaidSession, isBotTrackingRow } from './paid-session-filter'

describe('paid session filter', () => {
  it('detects bot-classified tracking rows', () => {
    expect(isBotTrackingRow({ payload: { device: { device_type: 'bot' } } })).toBe(true)
    expect(isBotTrackingRow({ payload: { browser: { name: 'Googlebot' } } })).toBe(true)
    expect(isBotTrackingRow({ payload: { device: { device_type: 'desktop' }, browser: { name: 'Chrome' } } })).toBe(false)
  })

  it('hides bot-only paid sessions without lead signals', () => {
    expect(isBotOnlyPaidSession([
      { event_name: 'ppc_visit_started', payload: { device: { device_type: 'bot' } } },
      { event_name: 'section_viewed', payload: { device: { device_type: 'bot' } } },
    ])).toBe(true)
  })

  it('keeps converted sessions even when a bot row is present', () => {
    expect(hasLeadSignal({ event_name: 'lead_submitted', payload: { device: { device_type: 'bot' } } })).toBe(true)
    expect(isBotOnlyPaidSession([
      { event_name: 'ppc_visit_started', payload: { device: { device_type: 'bot' } } },
      { event_name: 'lead_submitted', form_status: 'submitted', lead_id: 'lead-1', payload: { device: { device_type: 'bot' } } },
    ])).toBe(false)
  })
})
