import { describe, expect, it, vi } from 'vitest'

import {
  buildMojoPerformanceSnapshot,
  fetchMojoPerformanceSnapshot,
  mojoPerformanceDatasetDigest,
  storeMojoPerformanceSnapshot,
  syncMojoPerformanceSnapshot,
} from '../../../scripts/mojo-kpi-snapshot.mjs'

const payload = {
  success: true,
  data_by_month: {
    '1': {
      used_todays_data: false,
      data: [{
        month: 8,
        month_string: '08/24/2026',
        year: 2026,
        seconds: 7667.376345,
        calls: 304,
        contacts: 8,
        leads: 0,
        appointments: 0,
      }],
    },
  },
}

describe('Mojo KPI snapshot adapter', () => {
  it('maps provider dashboard totals to one deterministic daily snapshot', () => {
    const snapshot = buildMojoPerformanceSnapshot(payload, {
      fetchedAt: '2026-08-24T22:42:00.000Z',
    })
    expect(snapshot).toMatchObject({
      agentKey: 'casey',
      metricDate: '2026-08-24',
      providerTimezone: 'America/Chicago',
      dialingSeconds: 7667.376,
      calls: 304,
      contacts: 8,
      leads: 0,
      appointments: 0,
    })
    expect(snapshot.sourceDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(mojoPerformanceDatasetDigest([snapshot])).toMatch(/^[a-f0-9]{64}$/)
  })

  it('fetches only the authenticated daily KPI read contract', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const snapshot = await fetchMojoPerformanceSnapshot({
      sessionId: 'private-session',
      fetchedAt: '2026-08-24T22:42:00.000Z',
      fetchImpl: fetchMock,
    })
    expect(snapshot.calls).toBe(304)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://app71.mojosells.com/kpi/get_historical_data/',
      expect.objectContaining({ method: 'POST' }),
    )
    const request = fetchMock.mock.calls[0][1]
    expect(String(request.body)).toContain('start_date=08%2F24%2F2026')
  })

  it('fails closed on malformed KPI responses', () => {
    expect(() => buildMojoPerformanceSnapshot({ success: true })).toThrow(/requested exact-day totals/)
    expect(() => buildMojoPerformanceSnapshot({
      ...payload,
      data_by_month: { '1': { ...payload.data_by_month['1'], data: [{ month_string: '08/24/2026', calls: -1 }] } },
    })).toThrow()
  })

  it('posts the normalized snapshot to the protected CRM endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true, applied: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    const snapshot = buildMojoPerformanceSnapshot(payload, { fetchedAt: '2026-08-24T22:42:00.000Z' })
    await expect(storeMojoPerformanceSnapshot(snapshot, {
      endpoint: 'https://crm.savingkc.com/api/admin/mojo-performance',
      headers: { authorization: 'Bearer redacted' },
      fetchImpl: fetchMock,
    })).resolves.toMatchObject({ ok: true, applied: true })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://crm.savingkc.com/api/admin/mojo-performance',
      expect.objectContaining({ method: 'POST', body: JSON.stringify(snapshot) }),
    )
  })

  it('runs the provider read before the protected projection write', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(payload), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, applied: true }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      }))
    const stored = await syncMojoPerformanceSnapshot({
      sessionId: 'private-session',
      fetchedAt: '2026-08-24T22:42:00.000Z',
      endpoint: 'https://crm.savingkc.com/api/admin/mojo-performance',
      headers: { authorization: 'Bearer redacted' },
      fetchImpl: fetchMock,
    })
    expect(stored.snapshot).toMatchObject({ calls: 304, contacts: 8 })
    expect(stored.result).toEqual({ ok: true, applied: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
