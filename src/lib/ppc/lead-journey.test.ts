import { describe, expect, it } from 'vitest'
import { buildLeadJourney, loadLeadJourney } from './lead-journey'

const row = (event_name: string, event_time: string, payload: Record<string, unknown> = {}, page_path = '/') => ({
  event_name, event_time, page_path, page_location: null, traffic_source: 'ai_referral', payload,
})

describe('buildLeadJourney', () => {
  it('orders events, hides noise and labels each step', () => {
    const steps = buildLeadJourney([
      row('form_step_completed', '2026-11-06T15:02:00Z', { completed_step: 1, step_name: 'situation' }),
      row('page_view', '2026-11-06T15:00:00Z', { ai_source: 'chatgpt' }, '/probate/'),
      row('skc_phone_number_selected', '2026-11-06T15:00:01Z'),
      row('cta_click', '2026-11-06T15:01:00Z', { cta_label: 'Get Cash Offer', cta_location: 'header' }),
      row('phone_click', '2026-11-06T15:03:00Z', { phone_spot: 'sticky_bar' }),
    ])
    expect(steps.map((s) => [s.event, s.detail])).toEqual([
      ['page_view', 'via chatgpt'],
      ['cta_click', 'Get Cash Offer in header'],
      ['form_step_completed', 'step 1 (situation)'],
      ['phone_click', 'from sticky_bar'],
    ])
    expect(steps[0].page).toBe('/probate/')
  })
})

describe('loadLeadJourney', () => {
  function fakeDb(lead: { id: string; session_id: string | null } | null, bySession: unknown[], byLead: unknown[]) {
    const calls: string[] = []
    return {
      calls,
      db: {
        from: (table: string) => ({
          select: () => ({
            eq: (col: string, value: unknown) => ({
              maybeSingle: async () => ({ data: table === 'leads' ? lead : null, error: null }),
              eq: () => ({
                order: () => ({
                  limit: async () => { calls.push(`${col}=${value}`); return { data: col === 'session_id' ? bySession : byLead, error: null } },
                }),
              }),
            }),
          }),
        }),
      },
    }
  }

  it('joins events by the lead session id and dedupes rows also linked by lead_id', async () => {
    const shared = row('page_view', '2026-11-06T15:00:00Z')
    const f = fakeDb({ id: 'lead-1', session_id: 'sid-1' }, [shared, row('cta_click', '2026-11-06T15:01:00Z')], [shared])
    const out = await loadLeadJourney(f.db as never, 'lead-1')
    expect(f.calls).toEqual(['lead_id=lead-1', 'session_id=sid-1'])
    expect('journey' in out && out.journey.map((s) => s.event)).toEqual(['page_view', 'cta_click'])
  })

  it('returns 404 for an unknown lead', async () => {
    const f = fakeDb(null, [], [])
    expect(await loadLeadJourney(f.db as never, 'nope')).toEqual({ error: 'Lead not found', status: 404 })
  })
})

import { summarizeJourney } from './lead-journey'
import { buildCrmTimeline } from './lead-crm-timeline'

describe('journey summary (G5)', () => {
  it('counts visits by session, days to lead and ad clicks', () => {
    const rows = [
      { ...row('page_view', '2026-11-02T15:00:00Z'), session_id: 's1', gclid: 'Cj0' },
      { ...row('tool_used', '2026-11-02T15:05:00Z', { tool: 'tax_lookup' }), session_id: 's1', gclid: null },
      { ...row('page_view', '2026-11-05T10:00:00Z'), session_id: 's2', gclid: null },
      { ...row('skc_phone_number_selected', '2026-11-01T10:00:00Z'), session_id: 's0', gclid: null },
    ]
    expect(summarizeJourney(rows, '2026-11-05T10:20:00Z')).toEqual({
      visits: 2, webEvents: 3, firstSeenAt: '2026-11-02T15:00:00.000Z', daysToLead: 2, adClick: true,
    })
    expect(buildLeadJourney(rows).find((s) => s.event === 'tool_used')?.detail).toBe('tax lookup')
  })

  it('is empty without web events', () => {
    expect(summarizeJourney([], '2026-11-05T10:20:00Z')).toEqual({ visits: 0, webEvents: 0, firstSeenAt: null, daysToLead: null, adClick: false })
  })
})

describe('CRM timeline (G5)', () => {
  it('drops web rows and bookkeeping, keeps order, trims detail', () => {
    const steps = buildCrmTimeline([
      { occurred_at: '2026-11-05T12:00:00Z', kind: 'stage', event: 'advance', detail: 'new → contacted' },
      { occurred_at: '2026-11-05T10:20:00Z', kind: 'crm', event: 'lead_created', detail: 'website_form' },
      { occurred_at: '2026-11-05T10:25:00Z', kind: 'activity', event: 'reprocess', detail: 'x' },
      { occurred_at: '2026-11-05T10:00:00Z', kind: 'web', event: 'page_view', detail: '/' },
      { occurred_at: '2026-11-05T11:00:00Z', kind: 'activity', event: 'call', detail: `  Talked   about ${'x'.repeat(200)}` },
    ])
    expect(steps.map((s) => s.event)).toEqual(['lead_created', 'call', 'advance'])
    expect(steps[1].detail?.startsWith('Talked about')).toBe(true)
    expect(steps[1].detail?.length).toBe(140)
  })
})
