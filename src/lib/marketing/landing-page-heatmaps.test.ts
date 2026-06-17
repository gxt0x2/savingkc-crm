import { describe, expect, it } from 'vitest'
import {
  buildLandingPageHeatmapReport,
  dealPageEventsToHeatmapRows,
  type DealPageHeatmapEventRow,
  type LandingHeatmapEventRow,
} from './landing-page-heatmaps'

function row(overrides: Partial<LandingHeatmapEventRow>): LandingHeatmapEventRow {
  return {
    id: overrides.event_id || 'event',
    event_id: overrides.event_id || 'event',
    event_name: overrides.event_name || 'page_view',
    event_category: overrides.event_category ?? 'web',
    event_time: overrides.event_time || '2026-06-04T12:00:00.000Z',
    session_id: overrides.session_id ?? 'session-1',
    visitor_id: overrides.visitor_id ?? 'visitor-1',
    lead_id: overrides.lead_id ?? null,
    page_path: overrides.page_path ?? '/ppc',
    page_location: overrides.page_location ?? 'https://savingkc.com/ppc',
    campaign: overrides.campaign ?? 'Search 2026',
    form_step: overrides.form_step ?? null,
    payload: overrides.payload ?? {},
  }
}

function dealRow(overrides: Partial<DealPageHeatmapEventRow>): DealPageHeatmapEventRow {
  return {
    id: overrides.id ?? 'deal-event',
    event_id: overrides.event_id ?? 'deal-event-id',
    event_type: overrides.event_type ?? 'page_view',
    created_at: overrides.created_at ?? '2026-06-04T12:00:00.000Z',
    session_id: overrides.session_id ?? 'deal-session-1',
    visitor_id: overrides.visitor_id ?? 'deal-visitor-1',
    buyer_id: overrides.buyer_id ?? null,
    page_path: overrides.page_path ?? '/deals/test-deal',
    page_location: overrides.page_location ?? 'https://crm.savingkc.com/deals/test-deal',
    utm_campaign: overrides.utm_campaign ?? 'Investor Blast',
    metadata: overrides.metadata ?? {},
    section: overrides.section ?? null,
    element_text: overrides.element_text ?? null,
    element_tag: overrides.element_tag ?? null,
    x_pct: overrides.x_pct ?? null,
    y_pct: overrides.y_pct ?? null,
    scroll_pct: overrides.scroll_pct ?? null,
    share_id: overrides.share_id ?? null,
    ref_code: overrides.ref_code ?? null,
  }
}

describe('landing page heatmap report', () => {
  it('groups specific FAQ, CTA, and show-me interactions by page and section', () => {
    const report = buildLandingPageHeatmapReport({
      rows: [
        row({
          event_id: 'faq-1',
          event_name: 'faq_opened',
          payload: { faq_id: 'back-taxes', faq_question: 'Can I sell with back taxes?', section: 'faq' },
        }),
        row({
          event_id: 'cta-1',
          event_name: 'cta_click',
          payload: { cta_id: 'hero-phone', cta_label: 'Call now', section: 'hero', destination: 'tel:8166088808' },
        }),
        row({
          event_id: 'show-1',
          event_name: 'show_me_clicked',
          payload: { item_id: 'tax-liens', item_label: 'Show me tax lien examples', section: 'issues' },
          lead_id: 'lead-1',
        }),
      ],
      days: 7,
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-06-08T00:00:00.000Z',
    })

    expect(report.summary).toMatchObject({
      events: 3,
      sessions: 1,
      leads: 1,
      pages: 1,
      genericEvents: 0,
      specificityRate: 100,
    })
    expect(report.pages[0]?.faqs[0]).toMatchObject({
      label: 'Can I sell with back taxes?',
      section: 'Faq',
      detailCompleteness: 'specific',
    })
    expect(report.pages[0]?.ctas[0]).toMatchObject({
      label: 'Call now',
      section: 'Hero',
    })
    expect(report.pages[0]?.showMe[0]).toMatchObject({
      label: 'Show me tax lien examples',
      section: 'Issues',
      leads: 1,
    })
  })

  it('flags important generic events that are missing item-level detail', () => {
    const report = buildLandingPageHeatmapReport({
      rows: [
        row({ event_id: 'faq-generic', event_name: 'faq_opened', payload: { section: 'faq' } }),
        row({ event_id: 'cta-generic', event_name: 'cta_click', payload: { section: 'hero' } }),
      ],
      days: 7,
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-06-08T00:00:00.000Z',
    })

    expect(report.summary.genericEvents).toBe(2)
    expect(report.summary.specificityRate).toBe(0)
    expect(report.genericEvents).toEqual([
      { eventName: 'cta_click', count: 1, examplePage: 'PPC' },
      { eventName: 'faq_opened', count: 1, examplePage: 'PPC' },
    ])
    expect(report.pages[0]?.faqs[0]).toMatchObject({
      label: 'Unknown FAQ',
      detailCompleteness: 'generic',
    })
  })

  it('normalizes PPC tax and deal pages and honors page filters', () => {
    const report = buildLandingPageHeatmapReport({
      rows: [
        row({ event_id: 'ppc', page_path: '/ppc', page_location: 'https://savingkc.com/ppc' }),
        row({ event_id: 'tax', page_path: '/ppc-tax', page_location: 'https://savingkc.com/ppc-tax' }),
        row({ event_id: 'redemption', page_path: '/ppc-redemption', page_location: 'https://savingkc.com/ppc-redemption' }),
        row({ event_id: 'excess', page_path: '/ppc-excess-proceeds', page_location: 'https://savingkc.com/ppc-excess-proceeds' }),
        row({ event_id: 'deal', page_path: '/deals/abc123', page_location: 'https://crm.savingkc.com/deals/abc123' }),
      ],
      days: 30,
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-07-01T00:00:00.000Z',
      pageFilter: 'deals',
    })

    expect(report.pages).toHaveLength(1)
    expect(report.pages[0]?.pageKey).toBe('/deals')
    expect(report.pages[0]?.pageLabel).toBe('Deal Pages')
  })

  it('normalizes redemption and excess-proceeds PPC pages', () => {
    const report = buildLandingPageHeatmapReport({
      rows: [
        row({ event_id: 'redemption', page_path: '/ppc-redemption', page_location: 'https://savingkc.com/ppc-redemption' }),
        row({ event_id: 'excess', page_path: '/ppc-excess-proceeds', page_location: 'https://savingkc.com/ppc-excess-proceeds' }),
      ],
      days: 30,
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-07-01T00:00:00.000Z',
    })

    expect(report.pages.map((page) => page.pageKey).sort()).toEqual([
      '/ppc-excess-proceeds',
      '/ppc-redemption',
    ])
  })

  it('aggregates video progress milestones and max watch percentage', () => {
    const report = buildLandingPageHeatmapReport({
      rows: [
        row({ event_id: 'video-start', event_name: 'video_started', payload: { video_id: 'intro', title: 'Seller intro', section: 'team' } }),
        row({ event_id: 'video-50', event_name: 'video_progress_50', payload: { video_id: 'intro', title: 'Seller intro', section: 'team' } }),
        row({ event_id: 'video-complete', event_name: 'video_completed', payload: { video_id: 'intro', title: 'Seller intro', section: 'team' } }),
      ],
      days: 7,
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-06-08T00:00:00.000Z',
    })

    expect(report.pages[0]?.videos[0]).toMatchObject({
      label: 'Seller intro',
      starts: 1,
      progress25: 2,
      progress50: 2,
      progress75: 1,
      completes: 1,
      maxPercent: 100,
    })
  })

  it('normalizes deal page component events into heatmap CTA, show-me, and video buckets', () => {
    const rows = dealPageEventsToHeatmapRows([
      dealRow({
        event_id: 'photo',
        event_type: 'photo_open',
        metadata: { item_id: 'photo_2', item_label: 'Photo 2', section: 'gallery', position: 2 },
      }),
      dealRow({
        event_id: 'offer-open',
        event_type: 'offer_modal_open',
        metadata: { cta_id: 'deal_make_offer', cta_label: 'Make offer', section: 'pricing_sidebar' },
      }),
      dealRow({
        event_id: 'video-half',
        event_type: 'video_progress_50',
        metadata: { video_id: 'deal_video_1', video_title: 'Deal video 1', section: 'videos', watch_percent: 58 },
      }),
    ])

    const report = buildLandingPageHeatmapReport({
      rows,
      days: 7,
      since: '2026-06-01T00:00:00.000Z',
      until: '2026-06-08T00:00:00.000Z',
      pageFilter: 'deals',
    })

    expect(report.summary).toMatchObject({
      events: 3,
      pages: 1,
      specificityRate: 100,
    })
    expect(report.pages[0]?.showMe[0]).toMatchObject({
      label: 'Photo 2',
      section: 'Gallery',
    })
    expect(report.pages[0]?.ctas[0]).toMatchObject({
      label: 'Make offer',
      section: 'Pricing Sidebar',
    })
    expect(report.pages[0]?.videos[0]).toMatchObject({
      label: 'Deal video 1',
      progress25: 1,
      progress50: 1,
      maxPercent: 58,
    })
  })
})
