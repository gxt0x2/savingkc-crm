import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadNewestMatrixDay, matrixPartForFile, matrixSetComplete, readMatrixDay } from '@/lib/market-check/day-load'
import { matrixStatusRank } from '@/lib/market-check/plan'
import { SERVICE_COUNTIES, TARGET_ZIPS } from '@/lib/market-check/seeds'

const HEADER = 'MLS #,St,Address,Zip,Close Dt,Expire Date,List Price,Parcel ID'

describe('matrix day contract', () => {
  it('names the four file parts and does not treat one part as a complete set', () => {
    expect(matrixPartForFile('Active Coming Soon.csv')).toBe('active')
    expect(matrixPartForFile('Pending.csv')).toBe('pending')
    expect(matrixPartForFile('Sold since 2026-01-01.csv')).toBe('sold')
    expect(matrixPartForFile('Expired last 90 days.csv')).toBe('expired')
    expect(matrixSetComplete(['active'])).toBe(false)
    expect(matrixSetComplete(['active', 'pending', 'sold', 'expired'])).toBe(true)
  })

  it('reads the newest date folder and stays incomplete after the 4:00am lock', () => {
    const root = mkdtempSync(join(tmpdir(), 'mls-exports-'))
    mkdirSync(join(root, '2026-11-13'))
    mkdirSync(join(root, '2026-11-14'))
    for (const name of ['Active.csv', 'Pending.csv', 'Sold.csv', 'Expired.csv']) {
      writeFileSync(join(root, '2026-11-14', name), `${HEADER}\n1,Active,10 Oak St,64114,,,100,P1\n`)
    }
    const beforeLock = new Date('2026-11-14T08:00:00Z')
    const loaded = loadNewestMatrixDay(root, beforeLock)
    expect(loaded?.date).toBe('2026-11-14')
    expect(loaded?.complete).toBe(true)
    expect(loaded?.missing).toEqual([])
    const afterLock = readMatrixDay(join(root, '2026-11-14'), '2026-11-14', new Date('2026-11-14T10:30:00Z'))
    expect(afterLock.complete).toBe(false)
  })

  it('ranks an unknown listing above expired so the unknown check blocks', () => {
    expect(matrixStatusRank('listing_check_unknown')).toBeGreaterThan(matrixStatusRank('listing_expired'))
  })

  it('seeds all five service counties and leaves Cass out', () => {
    expect(SERVICE_COUNTIES).toEqual(['jackson', 'clay', 'platte', 'johnson', 'wyandotte'])
    for (const county of SERVICE_COUNTIES) {
      expect(TARGET_ZIPS.some((zip) => zip.county === county)).toBe(true)
    }
    expect(TARGET_ZIPS.some((zip) => zip.county === 'johnson' && zip.state === 'KS')).toBe(true)
    expect(TARGET_ZIPS.some((zip) => zip.county === 'wyandotte' && zip.state === 'KS')).toBe(true)
    expect(TARGET_ZIPS.some((zip) => zip.county === 'cass' as string)).toBe(false)
    expect(TARGET_ZIPS.map((zip) => zip.zip5)).not.toEqual(expect.arrayContaining(['64012', '64078', '64080', '64701']))
  })
})
