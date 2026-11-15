import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadTodayMatrixDay, matrixPartForFile, matrixSetComplete, readMatrixDay } from '@/lib/market-check/day-load'
import { matrixStatusRank } from '@/lib/market-check/plan'

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

  it('requires today, non-empty expired and sold parts, a done marker, and a clock before 4:00am Chicago', () => {
    const root = mkdtempSync(join(tmpdir(), 'mls-exports-'))
    mkdirSync(join(root, '2026-11-13'))
    mkdirSync(join(root, '2026-11-14'))
    for (const name of ['Active.csv', 'Pending.csv', 'Sold.csv', 'Expired.csv']) {
      writeFileSync(join(root, '2026-11-14', name), `${HEADER}\n1,Active,10 Oak St,64114,,,100,P1\n`)
    }
    writeFileSync(join(root, '2026-11-14', 'done'), '2026-11-14\n')
    const beforeLock = new Date('2026-11-14T08:00:00Z')
    const loaded = loadTodayMatrixDay(root, beforeLock)
    expect(loaded?.date).toBe('2026-11-14')
    expect(loaded?.complete).toBe(true)
    expect(loaded?.partCounts.expired).toBeGreaterThan(0)
    expect(loaded?.partCounts.sold).toBeGreaterThan(0)
    expect(loadTodayMatrixDay(root, new Date('2026-11-15T08:00:00Z'))).toBeNull()
    const headerOnly = readMatrixDay(join(root, '2026-11-14'), '2026-11-14', beforeLock)
    expect(headerOnly.complete).toBe(true)
    writeFileSync(join(root, '2026-11-14', 'Sold.csv'), `${HEADER}\n`)
    expect(readMatrixDay(join(root, '2026-11-14'), '2026-11-14', beforeLock).complete).toBe(false)
    writeFileSync(join(root, '2026-11-14', 'Sold.csv'), `${HEADER}\n1,Sold,10 Oak St,64114,2026-02-01,,100,P1\n`)
    writeFileSync(join(root, '2026-11-14', 'done'), '2026-11-13\n')
    expect(readMatrixDay(join(root, '2026-11-14'), '2026-11-14', beforeLock).complete).toBe(false)
    writeFileSync(join(root, '2026-11-14', 'done'), '2026-11-14\n')
    const afterLock = readMatrixDay(join(root, '2026-11-14'), '2026-11-14', new Date('2026-11-14T10:30:00Z'))
    expect(afterLock.complete).toBe(false)
  })

  it('ranks an unknown listing above expired so the unknown check blocks', () => {
    expect(matrixStatusRank('listing_check_unknown')).toBeGreaterThan(matrixStatusRank('listing_expired'))
  })

})
