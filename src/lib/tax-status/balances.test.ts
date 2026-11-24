import { describe, expect, it, vi } from 'vitest'
import { parseJacksonTaxPortalText, parseJohnsonTaxBillHtml, summarizePlatteTaxRows } from './balances'
import { createLiveBalanceLookup } from './live-lookup'

describe('county balance parsers', () => {
  it('reads Jackson total due and prior past-due years', () => {
    const text = [
      'Total Due: $1,250.00',
      '2024',
      '$400.00 $10.00 $5.00 $0.00',
      'Past Due',
      '2025',
      '$800.00 $10.00 $5.00 $0.00',
      'Past Due',
    ].join('\n')
    const parsed = parseJacksonTaxPortalText(text, new Date('2026-11-15T09:00:00.000Z'))
    expect(parsed.balance).toBe(1250)
    expect(parsed.yearsOwed).toBe(2)
    expect(parsed.taxStatus).toBe('delinquent')
  })

  it('reads a Johnson tax bill total and past years', () => {
    const html = '<div>Past Years Due</div><span>$750.00</span><div>Total Due</div><span>$750.00</span>'
    expect(parseJohnsonTaxBillHtml(html)).toMatchObject({ balance: 750, yearsOwed: 1, redeemed: false })
  })

  it('treats a redeemed Platte history with nothing unpaid as not owed', () => {
    expect(summarizePlatteTaxRows([
      { year: 2023, amount: 100, paid: true, redeemed: true },
      { year: 2024, amount: 0, paid: true },
    ], new Date('2026-11-15T09:00:00.000Z'))).toMatchObject({ balance: 0, yearsOwed: 0, redeemed: true })
  })
})

describe('live lookup', () => {
  it('sums Clay string balances and fails closed when any year request fails', async () => {
    const now = new Date('2026-11-15T09:00:00.000Z')
    const okFetch = vi.fn(async (url: string) => {
      const year = new URL(url).searchParams.get('tax_year')
      if (year === '2025') return { ok: true, json: async () => ({ success: true, data: { balance_amount: '1,000.00' } }) }
      return { ok: true, json: async () => ({ success: true, data: { no_charges_due: true, balance_amount: '999.00' } }) }
    })
    const looked = await createLiveBalanceLookup(okFetch as unknown as typeof fetch, now)({ county: 'clay', parcelId: '12345678901234' })
    expect(looked.ok).toBe(true)
    if (looked.ok) expect(looked.balance.balance).toBe(1000)

    const downFetch = vi.fn(async (url: string) => {
      const year = new URL(url).searchParams.get('tax_year')
      if (year === '2024') return { ok: false, json: async () => ({}) }
      return { ok: true, json: async () => ({ success: true, data: { no_charges_due: true } }) }
    })
    const closed = await createLiveBalanceLookup(downFetch as unknown as typeof fetch, now)({ county: 'clay', parcelId: '12345678901234' })
    expect(closed).toEqual({ ok: false, source: 'clay_collector', reason: 'source_down' })
  })

  it('returns source_down for Wyandotte when the page has no tax balance', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, text: async () => '<html>Appraised Value $10</html>' }))
    const lookup = createLiveBalanceLookup(fetchImpl as unknown as typeof fetch, new Date('2026-11-15T09:00:00.000Z'))
    const result = await lookup({ county: 'wyandotte', parcelId: 'R1' })
    expect(result).toEqual({ ok: false, source: 'wyandotte_tax', reason: 'source_down' })
  })
})
