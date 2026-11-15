import { describe, expect, it } from 'vitest'
import { intakeAllowed } from '@/lib/market-check/plan'
import { parseTargetZips, PRICE_THRESHOLDS, TARGET_ZIPS } from '@/lib/market-check/seeds'

describe('Katherine market seeds', () => {
  it('loads the Jackson file as-is and does not invent other counties', () => {
    expect(TARGET_ZIPS).toHaveLength(42)
    expect(PRICE_THRESHOLDS).toHaveLength(42)
    expect(new Set(TARGET_ZIPS.map((zip) => zip.county))).toEqual(new Set(['jackson']))
    expect(new Set(TARGET_ZIPS.map((zip) => zip.state))).toEqual(new Set(['MO']))
    expect(TARGET_ZIPS.some((zip) => zip.county === 'cass')).toBe(false)
    expect(TARGET_ZIPS.filter((zip) => zip.status === 'core').map((zip) => zip.zip5)).toEqual([
      '64030', '64055', '64063', '64114', '64133', '64134', '64138',
    ])
    expect(TARGET_ZIPS.filter((zip) => zip.status === 'avoid').map((zip) => zip.zip5)).toEqual([
      '64125', '64126', '64127', '64128', '64129', '64130',
    ])
    expect(TARGET_ZIPS.find((zip) => zip.zip5 === '64131')?.status).toBe('parked')
    expect(PRICE_THRESHOLDS.find((row) => row.zip5 === '64134')).toEqual({
      zip5: '64134',
      minListPrice: 180000,
      method: 'owner_override',
      confidence: 'high',
    })
    for (const price of PRICE_THRESHOLDS) {
      expect(TARGET_ZIPS.some((zip) => zip.zip5 === price.zip5)).toBe(true)
    }
  })

  it('accepts a later county row without a code change', () => {
    const extra = parseTargetZips('zip5,county,state,status\n64079,platte,MO,keep\n')
    expect(extra).toEqual([{ zip5: '64079', county: 'platte', state: 'MO', status: 'keep' }])
    expect(intakeAllowed('avoid')).toBe(false)
    expect(intakeAllowed('parked')).toBe(false)
    expect(intakeAllowed('core')).toBe(true)
  })
})
