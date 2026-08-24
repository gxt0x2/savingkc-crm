import { describe, expect, it } from 'vitest'
import { attributionFromTrackingRows, type PpcTrackingAttributionRow } from './tracking-attribution'

function row(overrides: Partial<PpcTrackingAttributionRow>): PpcTrackingAttributionRow {
  return {
    traffic_source: null,
    campaign: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    utm_term: null,
    utm_content: null,
    gclid: null,
    gbraid: null,
    wbraid: null,
    gad_source: null,
    gad_campaignid: null,
    gad_adgroupid: null,
    page_path: null,
    page_location: null,
    page_referrer: null,
    payload: null,
    event_time: null,
    ...overrides,
  }
}

describe('canonical PPC tracking attribution', () => {
  it('merges bounded history while allowing the newest typed evidence to win', () => {
    expect(attributionFromTrackingRows([
      row({
        event_time: '2026-08-24T02:00:00.000Z',
        campaign: 'Current Search',
        gclid: 'current-click',
        payload: { attribution: { keyword: 'sell house' }, source: 'ppc_form_submit' },
      }),
      row({
        event_time: '2026-08-24T01:00:00.000Z',
        campaign: 'Older Search',
        utm_medium: 'cpc',
        payload: { attribution: { gclid: 'older-click', matchtype: 'phrase' } },
      }),
    ])).toMatchObject({
      campaign: 'Current Search',
      gclid: 'current-click',
      utm_medium: 'cpc',
      keyword: 'sell house',
      matchtype: 'phrase',
      source: 'ppc_form_submit',
    })
  })
})
