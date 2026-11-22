import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ context: vi.fn(), enqueue: vi.fn() }))
vi.mock('@/lib/ppc/lead-conversion-context', () => ({ loadPpcLeadConversionContext: mocks.context }))
vi.mock('@/lib/ppc/conversion-outbox', () => ({ enqueuePpcConversion: mocks.enqueue }))

import { queuePpcDealConversion } from './deal-conversion'
import { isGoogleAdsDealPpcEvent, isGoogleAdsExportablePpcEvent, isGoogleAdsFactualPpcEvent } from './exportable-events'

describe('deal conversions (G6)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('queues a paid lead once per event with the standard value, never the fee', async () => {
    mocks.context.mockResolvedValue({ ok: true, attribution: { gclid: 'Cj0' }, userIdentifiers: [] })
    mocks.enqueue.mockResolvedValue({ queued: true })
    await expect(queuePpcDealConversion({ leadId: 'L1', eventName: 'deal_closed', occurredAt: '2026-11-20T15:00:00Z', source: 'disposition_closeout', referenceId: 'D1' }))
      .resolves.toEqual({ queued: true, reason: 'queued' })
    expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({
      eventName: 'deal_closed',
      eventCategory: 'deal',
      dedupeKey: 'lead:L1:deal_closed',
      conversionValue: 1,
      approvedForGoogleAds: true,
      eventTime: '2026-11-20T15:00:00Z',
    }))
  })

  it('skips leads without paid evidence', async () => {
    mocks.context.mockResolvedValue({ ok: false, reason: 'not_ppc_lead' })
    await expect(queuePpcDealConversion({ leadId: 'L2', eventName: 'contract_signed', source: 'x' })).resolves.toEqual({ queued: false, reason: 'not_ppc_lead' })
    expect(mocks.enqueue).not.toHaveBeenCalled()
  })

  it('treats both as exportable factual deal events', () => {
    for (const name of ['contract_signed', 'deal_closed']) {
      expect(isGoogleAdsExportablePpcEvent(name)).toBe(true)
      expect(isGoogleAdsFactualPpcEvent(name)).toBe(true)
      expect(isGoogleAdsDealPpcEvent(name)).toBe(true)
    }
    expect(isGoogleAdsDealPpcEvent('appointment_booked')).toBe(false)
  })
})
