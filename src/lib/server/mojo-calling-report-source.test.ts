import { describe, expect, it, vi } from 'vitest'
import { compareMojoCallBackfill, runMojoCallBackfill } from './mojo-call-ledger'
import { callingReportBody, centralOffset, createSessionCallingReportSource } from './mojo-call-source'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

function reportRow(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    contact: { id: 900 + id, full_name: 'Pat Example', list_name: 'Jackson T3', address: '1 Main St', full_address: '1 Main St KC MO', groups: [] },
    phone_number: '816-555-0142',
    result: 'No Answer',
    result_represent: 'No Answer',
    caller_number: '816-555-0199',
    session_type: 'Power Dial',
    create_date: '2026-10-19T13:12:38.446451-05:00',
    notes: ['called back later'],
    lead_exists: 0,
    appointment_exists: 0,
    session: { id: 476, start: '2026-10-19T13:00:00-05:00' },
    is_recorded: false,
    agent_name: 'Ernest Dodson',
    dialed_from: 'Dialer',
    ...overrides,
  }
}

describe('Mojo calling report source', () => {
  it('posts whole Central days for all agents and keeps no names, notes or full numbers', async () => {
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      expect((init?.headers as { cookie?: string }).cookie).toBe('sessionid=scraper-session')
      if (url.includes('call-recording-report-data')) {
        return json({ recordings: [{ call_id: 31598, duration: '1:05', create_date: '2026-10-19T18:30:00Z' }] })
      }
      expect(url).toBe('https://app71.mojosells.com/v2/rest/reports/calling-report-calls/')
      const body = JSON.parse(String(init?.body))
      expect(body).toMatchObject({ agents: '[]', start_date: '2026-10-19T00:00:00-05:00', end_date: '2026-10-19T23:59:59-05:00', page: 1, page_size: 500 })
      expect(body).not.toHaveProperty('date_range')
      return json({ total_count: 2, total_pages: 1, page: 1, results: [reportRow(31597), reportRow(31598, { result: 'Contact', is_recorded: true, lead_exists: 1, appointment_exists: 1 })] })
    })
    const source = createSessionCallingReportSource({ sessionId: 'scraper-session', fetchImpl })
    const page = await source.listCalls({ dateFrom: '2026-10-19', dateTo: '2026-10-19', page: 1, pageSize: 500 })
    expect(page.results.map((call) => [call.record_id, call.dial_session_id, call.phone_last4, call.duration_seconds, call.result_label, call.lead_exists, call.appointment_count]))
      .toEqual([
        ['mojo-call-31597', '476', '0142', 0, 'No Answer', false, 0],
        ['mojo-call-31598', '476', '0142', 65, 'Contact', true, 1],
      ])
    expect(page.results[0]?.source).toBe('mojo_session_calling_report')
    expect(page.results[0]?.caller_id).toBe('+18165550199')
    const text = JSON.stringify(page.results)
    for (const leaked of ['Pat Example', 'Main St', '555-0142', 'called back', 'Ernest']) expect(text).not.toContain(leaked)
  })

  it('treats a login page or 403 as an expired session', async () => {
    const login = createSessionCallingReportSource({
      sessionId: 's',
      fetchImpl: async (url) => url.includes('recording') ? json({ recordings: [] }) : new Response('<html>login</html>', { status: 200 }),
    })
    await expect(login.listCalls({ dateFrom: '2026-10-19', dateTo: '2026-10-19' })).rejects.toThrow('session_expired')
    const denied = createSessionCallingReportSource({ sessionId: 's', fetchImpl: async () => json({}, 403) })
    await expect(denied.listCalls({ dateFrom: '2026-10-19', dateTo: '2026-10-19' })).rejects.toThrow('session_expired')
  })

  it('meets the expected backfill counts when Mojo returns the 11/07 shape', async () => {
    const rows = [
      ...Array.from({ length: 249 }, (_, i) => reportRow(31300 + i, { create_date: '2026-10-09T15:00:00-05:00', session: { id: 470 } })),
      ...Array.from({ length: 346 }, (_, i) => reportRow(31597 + i, { session: { id: i < 3 ? 474 : i < 50 ? 475 : 476 } })),
    ]
    const fetchImpl = async (url: string, init?: RequestInit) => {
      if (url.includes('recording')) return json({ recordings: [] })
      const { page, page_size: size } = JSON.parse(String(init?.body))
      return json({ total_count: rows.length, total_pages: Math.ceil(rows.length / size), page, results: rows.slice((page - 1) * size, page * size) })
    }
    const result = await runMojoCallBackfill({ source: createSessionCallingReportSource({ sessionId: 's', fetchImpl }), apply: false })
    expect(result.calls).toBe(595)
    expect(compareMojoCallBackfill(result.summary)).toMatchObject({ matches: true })
  })

  it('uses the Central offset for the date', () => {
    expect(centralOffset('2026-10-19')).toBe('-05:00')
    expect(centralOffset('2026-12-01')).toBe('-06:00')
    expect(callingReportBody('2026-12-01', '2026-12-02', 2, 100)).toMatchObject({ start_date: '2026-12-01T00:00:00-06:00', page: 2, page_size: 100 })
  })
})
