import { afterEach, describe, expect, it, vi } from 'vitest'
import { CountyEnrichmentService, parseCollectorBalance } from './county-enrichment'

describe('parseCollectorBalance', () => {
  it('passes numbers through', () => {
    expect(parseCollectorBalance(1234.56)).toBe(1234.56)
    expect(parseCollectorBalance(0)).toBe(0)
  })
  it('parses plain and comma/dollar-formatted strings', () => {
    expect(parseCollectorBalance('1234.56')).toBe(1234.56)
    expect(parseCollectorBalance('1,234.56')).toBe(1234.56)
    expect(parseCollectorBalance('$1,234.56')).toBe(1234.56)
    expect(parseCollectorBalance(' 88 ')).toBe(88)
  })
  it('treats invalid input as 0', () => {
    expect(parseCollectorBalance('n/a')).toBe(0)
    expect(parseCollectorBalance('')).toBe(0)
    expect(parseCollectorBalance(null)).toBe(0)
    expect(parseCollectorBalance(undefined)).toBe(0)
    expect(parseCollectorBalance(Number.NaN)).toBe(0)
    expect(parseCollectorBalance({})).toBe(0)
  })
})

describe('enrichClayCountyTaxCollection balance handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function stubCollector(byYear: Record<number, unknown>) {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      const year = Number(new URL(url).searchParams.get('tax_year'))
      return { ok: true, json: async () => byYear[year] ?? { success: true, data: { no_charges_due: true } } }
    }))
  }

  const run = (svc: CountyEnrichmentService) =>
    (svc as unknown as { enrichClayCountyTaxCollection: (p: string) => Promise<{ totalOwed: number; currentAmountDue: number; pastYearsDue: number; yearsDelinquent: number }> })
      .enrichClayCountyTaxCollection('12345678901234')

  it('accumulates string balances into totalOwed', async () => {
    const y = new Date().getFullYear()
    stubCollector({
      [y - 1]: { success: true, data: { balance_amount: '1,234.56' } },
      [y - 2]: { success: true, data: { balance_amount: '1234.56' } },
    })
    const r = await run(new CountyEnrichmentService())
    expect(r.totalOwed).toBeCloseTo(2469.12)
    expect(r.currentAmountDue).toBeCloseTo(1234.56)
    expect(r.pastYearsDue).toBeCloseTo(1234.56)
    expect(r.yearsDelinquent).toBe(2)
  })

  it('keeps the numeric path unchanged', async () => {
    const y = new Date().getFullYear()
    stubCollector({ [y - 1]: { success: true, data: { balance_amount: 500 } } })
    const r = await run(new CountyEnrichmentService())
    expect(r.totalOwed).toBe(500)
    expect(r.yearsDelinquent).toBe(1)
  })

  it('still short-circuits on no_charges_due', async () => {
    const y = new Date().getFullYear()
    stubCollector({ [y - 1]: { success: true, data: { no_charges_due: true, balance_amount: '999.00' } } })
    const r = await run(new CountyEnrichmentService())
    expect(r.totalOwed).toBe(0)
    expect(r.yearsDelinquent).toBe(0)
  })
})
