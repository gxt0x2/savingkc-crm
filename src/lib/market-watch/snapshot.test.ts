import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import august2026 from '@/data/wholesale-market/august-2026.json'

import { bundledWholesaleMarketSnapshots } from './catalog'
import {
  filterWholesaleZips,
  formatDom,
  formatMoi,
  formatMoney,
  mergeWholesaleMarketSnapshots,
  nextZipSort,
  parseWholesaleMarketSnapshot,
  sortWholesaleZips,
  WholesaleMarketSnapshotError,
} from './snapshot'

const snapshot = bundledWholesaleMarketSnapshots()[0]
const migration = readFileSync(join(process.cwd(), 'supabase/migrations/20261120120100_wholesale_market_snapshots.sql'), 'utf8')

describe('August 2026 wholesale market snapshot', () => {
  it('keeps the Matrix summary and does not invent zip counts', () => {
    expect(snapshot.meta.month_key).toBe('2026-08')
    expect(snapshot.summary).toMatchObject({
      sold_records: 2315,
      active_records: 5187,
      sold_median_close: 375000,
      sold_median_dom: 10,
      fit_zip_count: 28,
      metro_moi: 2.24,
      primary_target_count: 17,
    })
    expect(snapshot.zips).toHaveLength(28)
    expect(snapshot.zips.filter((zip) => zip.primary_target)).toHaveLength(17)
    expect(snapshot.insights[0]).toMatchObject({ kind: 'Top volume', zip: '64118', metric: '57 solds' })
    expect(snapshot.insights[1]).toMatchObject({ kind: 'Tightest inventory', zip: '66202', metric: 'MOI 0.61' })
    expect(snapshot.counties.find((county) => county.county === 'Clay MO')).toMatchObject({ sum_solds: 189, sum_actives: 273, avg_moi: 1.51 })
    expect(snapshot.counties.find((county) => county.county === 'Johnson KS')?.kcrar.median_sales_price).toBe(465173)
    expect(snapshot.meta.methodology.join('\n')).toMatch(/64125/)
    expect(snapshot.meta.methodology.join('\n')).toMatch(/64131/)
    expect(snapshot.meta.methodology.join('\n')).toMatch(/not CRM leads|not dump these zips as CRM leads/i)
  })

  it('filters and sorts like the analyst report', () => {
    expect(sortWholesaleZips(snapshot.zips, 'solds', 'desc')[0]).toMatchObject({ zip: '64118', solds: 57 })
    expect(filterWholesaleZips(snapshot.zips, { query: '66202', county: '', moiBand: '', primaryOnly: false }).map((zip) => zip.zip)).toEqual(['66202'])
    expect(filterWholesaleZips(snapshot.zips, { query: '', county: 'Jackson MO', moiBand: '', primaryOnly: false })).toHaveLength(10)
    expect(filterWholesaleZips(snapshot.zips, { query: '', county: '', moiBand: 'Soft', primaryOnly: false }).map((zip) => zip.zip).sort()).toEqual(['64079', '64133', '66104'])
    expect(filterWholesaleZips(snapshot.zips, { query: '', county: '', moiBand: '', primaryOnly: true })).toHaveLength(17)
    expect(sortWholesaleZips(snapshot.zips, 'zip', 'asc')[0]?.zip).toBe('64014')
    expect(nextZipSort({ column: 'solds', direction: 'desc' }, 'solds').direction).toBe('asc')
    expect(nextZipSort({ column: 'solds', direction: 'desc' }, 'county')).toEqual({ column: 'county', direction: 'asc' })
  })

  it('formats display values without changing the stored numbers', () => {
    const overlandPark = snapshot.zips.find((zip) => zip.zip === '66030')
    expect(overlandPark?.median_close).toBe(379802.5)
    expect(formatMoney(379802.5)).toBe('$379,803')
    expect(formatMoney(375000)).toBe('$375,000')
    expect(formatMoi(0.9649122807017544)).toBe('0.96')
    expect(formatDom(10)).toBe('10')
    expect(formatDom(5.5)).toBe('5.5')
  })

  it('rejects a snapshot whose primary-target flag disagrees with the rule', () => {
    const broken = structuredClone(august2026)
    broken.zips[0].primary_target = false
    expect(() => parseWholesaleMarketSnapshot(broken)).toThrow(WholesaleMarketSnapshotError)
  })

  it('lets a stored month replace the bundled seed and keeps older months', () => {
    const september = {
      ...snapshot,
      meta: { ...snapshot.meta, month_key: '2026-09', month: 'September 2026' },
    }
    const correctedAugust = { ...snapshot, summary: { ...snapshot.summary, sold_records: 2315 } }
    expect(mergeWholesaleMarketSnapshots([snapshot], [september]).map((item) => item.meta.month_key)).toEqual(['2026-09', '2026-08'])
    expect(mergeWholesaleMarketSnapshots([snapshot], [correctedAugust])).toHaveLength(1)
  })

  it('seeds August in a read-only snapshot table and does not enroll leads', () => {
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS public.wholesale_market_snapshots')
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY')
    expect(migration).toContain('REVOKE ALL ON TABLE public.wholesale_market_snapshots FROM PUBLIC, anon, authenticated')
    expect(migration).toContain('GRANT SELECT ON TABLE public.wholesale_market_snapshots TO authenticated')
    expect(migration).toContain("VALUES (\n  '2026-08'")
    expect(migration).toContain('"sold_records": 2315')
    expect(migration).toContain('"zip": "64118"')
    expect(migration).not.toMatch(/INSERT INTO public\.(leads|prospects|contacts|opportunities)/i)
  })
})
