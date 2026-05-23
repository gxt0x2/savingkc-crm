import { describe, expect, it } from 'vitest'
import {
  buildPpcConversionOutboxRow,
  cleanJsonRecord,
  enqueuePpcConversion,
  pickBestClickId,
  type PpcConversionOutboxRow,
} from './conversion-outbox'

describe('ppc conversion outbox', () => {
  it('prefers gclid over modeled click ids', () => {
    expect(pickBestClickId({ gclid: ' GCLID ', gbraid: 'GBRAID', wbraid: 'WBRAID' })).toEqual({
      clickId: 'GCLID',
      clickIdType: 'gclid',
    })
  })

  it('falls back to gbraid then wbraid', () => {
    expect(pickBestClickId({ gbraid: 'GBRAID', wbraid: 'WBRAID' })).toEqual({
      clickId: 'GBRAID',
      clickIdType: 'gbraid',
    })
    expect(pickBestClickId({ wbraid: 'WBRAID' })).toEqual({
      clickId: 'WBRAID',
      clickIdType: 'wbraid',
    })
  })

  it('builds a Google Ads row with campaign defaults and stable dedupe fields', () => {
    const row = buildPpcConversionOutboxRow({
      eventName: 'lead_submitted',
      eventCategory: 'form',
      dedupeKey: 'lead:123:lead_submitted',
      leadId: 'lead-123',
      manifestId: 'manifest-123',
      activityId: 'activity-123',
      optimizationRole: 'primary',
      conversionValue: 25,
      eventTime: '2026-05-20T12:00:00.000Z',
      attribution: {
        gclid: 'click-123',
        utm_source: 'google',
        ignored: undefined,
      },
      payload: {
        form_status: 'submitted',
        nested: { keep: true, drop: undefined },
      },
    })

    expect(row).toMatchObject({
      event_name: 'lead_submitted',
      event_category: 'form',
      destination: 'google_ads',
      dedupe_key: 'lead:123:lead_submitted',
      approved_for_google_ads: false,
      optimization_role: 'primary',
      lead_id: 'lead-123',
      manifest_id: 'manifest-123',
      activity_id: 'activity-123',
      conversion_value: 25,
      currency: 'USD',
      event_time: '2026-05-20T12:00:00.000Z',
      click_id: 'click-123',
      click_id_type: 'gclid',
      attribution: {
        gclid: 'click-123',
        utm_source: 'google',
      },
      payload: {
        traffic_source: 'google_ads',
        campaign: 'Search 2026',
        optimization_role: 'primary',
        form_status: 'submitted',
        nested: { keep: true },
      },
    })
  })

  it('removes undefined values before writing jsonb', () => {
    expect(cleanJsonRecord({ a: 1, b: undefined, c: { keep: true, drop: undefined } })).toEqual({
      a: 1,
      c: { keep: true },
    })
  })

  it('does not throw when the queue table is not deployed yet', async () => {
    const result = await enqueuePpcConversion(
      {
        eventName: 'appointment_booked',
        eventCategory: 'appointment',
        dedupeKey: 'lead:123:appointment_booked',
        leadId: 'lead-123',
        conversionValue: 100,
        eventTime: '2026-05-20T12:00:00.000Z',
      },
      {
        from: () => ({
          upsert: async (row: PpcConversionOutboxRow) => ({
            error: { code: '42P01', message: `relation does not exist for ${row.event_name}` },
          }),
        }),
      },
    )

    expect(result.queued).toBe(false)
    if (result.queued) throw new Error('Expected enqueue to fail for a missing table')
    expect(result.reason).toContain('relation does not exist')
  })
})
