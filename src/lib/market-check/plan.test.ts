import { describe, expect, it } from 'vitest'
import { ownersChanged } from '@/lib/market-check/address'
import { parseMatrixCsv } from '@/lib/market-check/matrix-csv'
import {
  crmLeadListingStatus,
  ksLicenseUnconfirmed,
  marketExportBlock,
  planMarketCheck,
  requiresLicenseeDisclosure,
  type ListingStatus,
  type PoolRowInput,
} from '@/lib/market-check/plan'
import { PRICE_THRESHOLDS, TARGET_ZIPS } from '@/lib/market-check/seeds'
import { additionListDay, marketCheckWindow, offMarketAllowed } from '@/lib/market-check/schedule'

const TODAY = '2026-11-14'

function targetMap() {
  return new Map(TARGET_ZIPS.map((zip) => [zip.zip5, zip]))
}

function priceMap() {
  return new Map(PRICE_THRESHOLDS.map((row) => [row.zip5, row.minListPrice]))
}

function pool(partial: Partial<PoolRowInput> & Pick<PoolRowInput, 'id' | 'address'>): PoolRowInput {
  return {
    listType: 'tax_delinquent',
    parcelId: null,
    zip5: null,
    state: 'MO',
    prospectOwner: 'ADA OWNER',
    rollOwner: 'ADA OWNER',
    ...partial,
  }
}

function plan(csv: string, rows: PoolRowInput[], extra: { allowOffMarket?: boolean; additionListDay?: string } = {}) {
  return planMarketCheck({
    rows: parseMatrixCsv(csv),
    poolRows: rows,
    targetStatusByZip: targetMap(),
    minListPriceByZip: priceMap(),
    today: TODAY,
    additionListDay: extra.additionListDay ?? TODAY,
    allowOffMarket: extra.allowOffMarket ?? true,
    completeFile: true,
    hasExpireColumn: true,
    fileSha256: 'a'.repeat(64),
  })
}

const FIXTURE = [
  'MLS #,St,Address,Zip,Close Dt,Expire Date,List Price,Parcel ID',
  '1001,Active,10 Oak St,64114,,,344000,P1001',
  '1002,Active,11 Oak St,64114,,,345000,P1002',
  '1003,Expired,12 Oak St,64114,,2026-11-01,200000,P1003',
  '1004,Expired,15 Oak St,99999,,2026-11-01,100000,P1006',
  '1005,Expired,16 Oak St,64131,,2026-11-01,100000,P1007',
  '1006,Pending,14 Oak St,64114,,,160000,P1005',
  '1007,Sold,13 Oak St,64114,2026-02-01,,150000,P1004',
  '1008,Sold,17 Oak St,64114,2025-12-01,,150000,P1008',
].join('\n')

describe('listed and sold market check', () => {
  it('blocks every seeded crm lead status', () => {
    const reasons = [
      ['listed', null],
      ['listed_agent', null],
      [null, 'listed'],
      ['already_sold', null],
      ['sold_or_competitor', null],
      [null, 'already sold'],
    ] as const
    for (const [deadReason, callResult] of reasons) {
      const status = crmLeadListingStatus(deadReason, callResult)
      expect(status).not.toBeNull()
      expect(marketExportBlock({
        enabled: true,
        expiredSourced: false,
        highPrice: false,
        ownerChanged: false,
        latestStatus: status,
        latestListDay: '2026-01-01',
        today: TODAY,
        expiredOwnerConfirmed: false,
        hasRelistCheckToday: false,
      })).toBe(status)
    }
    expect(crmLeadListingStatus('not_selling', null)).toBeNull()
  })

  it('blocks a zip the metro export does not cover, and a blank zip until a parcel matches', () => {
    const result = plan(FIXTURE, [
      pool({ id: 'missing-zip', address: '9 Pine St', zip5: '66061' }),
      pool({ id: 'blank', address: '9 Pine St', zip5: '' }),
      pool({ id: 'parcel-hit', address: '', zip5: '', parcelId: 'P1005' }),
    ])
    const byId = Object.fromEntries(result.checks.map((check) => [check.propertyKey.includes('row:') ? check.propertyKey : check.parcelId || check.addrNorm, check.listingStatus]))
    expect(result.checks.find((check) => check.propertyKey === 'row:missing-zip' || check.zip5 === '66061')?.listingStatus).toBe('listing_check_unknown')
    expect(result.checks.find((check) => check.propertyKey === 'row:blank')?.listingStatus).toBe('listing_check_unknown')
    expect(result.checks.find((check) => check.parcelId === 'P1005')?.listingStatus).toBe('listed_pending')
    expect(byId).toBeTruthy()
  })

  it('clears an unmatched covered address for today only', () => {
    const result = plan(FIXTURE, [pool({ id: 'clear', address: '20 Pine St', zip5: '64114' })])
    const check = result.checks.find((row) => row.propertyKey === 'row:clear' || row.addrNorm.includes('PINE'))
    expect(check?.listingStatus).toBe('off_market_ok')
    expect(check?.listDay).toBe(TODAY)
    expect(marketExportBlock({
      enabled: true,
      expiredSourced: false,
      highPrice: false,
      ownerChanged: false,
      latestStatus: 'off_market_ok',
      latestListDay: TODAY,
      today: TODAY,
      expiredOwnerConfirmed: false,
      hasRelistCheckToday: true,
    })).toBeNull()
    expect(marketExportBlock({
      enabled: true,
      expiredSourced: false,
      highPrice: false,
      ownerChanged: false,
      latestStatus: 'off_market_ok',
      latestListDay: TODAY,
      today: '2026-11-15',
      expiredOwnerConfirmed: false,
      hasRelistCheckToday: false,
    })).toBe('market_check_missing')
  })

  it('does not write off_market_ok after the 3:30am deadline', () => {
    const result = plan(FIXTURE, [pool({ id: 'late', address: '20 Pine St', zip5: '64114' })], { allowOffMarket: false })
    expect(result.checks.find((row) => row.addrNorm.includes('PINE'))?.listingStatus).toBe('listing_check_unknown')
  })

  it('blocks when the roll owner differs from the prospect owner', () => {
    expect(ownersChanged('OWNER ADA', 'ADA OWNER')).toBe(false)
    expect(ownersChanged('ADA L OWNER', 'ADA OWNER')).toBe(false)
    expect(ownersChanged('BOB OTHER', 'ADA OWNER')).toBe(true)
    const result = plan(FIXTURE, [pool({
      id: 'owner',
      address: '20 Pine St',
      zip5: '64114',
      rollOwner: 'BOB OTHER',
      prospectOwner: 'ADA OWNER',
    })])
    const check = result.checks.find((row) => row.addrNorm.includes('PINE'))
    expect(check?.ownerChanged).toBe(true)
    expect(marketExportBlock({
      enabled: true,
      expiredSourced: false,
      highPrice: false,
      ownerChanged: true,
      latestStatus: 'off_market_ok',
      latestListDay: TODAY,
      today: TODAY,
      expiredOwnerConfirmed: true,
      hasRelistCheckToday: true,
    })).toBe('owner_changed')
  })

  it('tags an in-target expired listing and ignores expired rows outside target, parked, and avoid', () => {
    const result = plan(FIXTURE, [
      pool({ id: 'already', address: '12 Oak St', zip5: '64114', parcelId: 'P1003' }),
    ])
    expect(result.tags).toContainEqual(expect.objectContaining({
      poolRowId: 'already',
      mlsTag: 'expired_listing',
      strategy: 'wholesale',
    }))
    expect(result.intakes.find((row) => row.zip5 === '64114' && row.addrNorm.includes('12'))).toBeUndefined()
    const fresh = plan(FIXTURE, [])
    expect(fresh.intakes.map((row) => row.zip5)).toEqual(['64114'])
    expect(fresh.intakes[0]?.state).toBe('MO')
    expect(requiresLicenseeDisclosure(true)).toBe(true)
    expect(fresh.tags).toEqual([])
    expect(fresh.intakes.some((row) => row.zip5 === '99999' || row.zip5 === '64131')).toBe(false)
  })

  it('keeps a below-threshold active as a plain listed block and sends the floor price to novation', () => {
    const result = plan(FIXTURE, [
      pool({ id: 'below', address: '10 Oak St', zip5: '64114', parcelId: 'P1001' }),
      pool({ id: 'above', address: '11 Oak St', zip5: '64114', parcelId: 'P1002' }),
    ])
    expect(result.checks.find((row) => row.parcelId === 'P1001')?.listingStatus).toBe('listed_active')
    expect(result.tags.find((tag) => tag.poolRowId === 'below')).toBeUndefined()
    expect(result.tags).toContainEqual(expect.objectContaining({
      poolRowId: 'above',
      mlsTag: 'active_high_price',
      strategy: 'novation_traditional',
    }))
    expect(marketExportBlock({
      enabled: true,
      expiredSourced: false,
      highPrice: false,
      ownerChanged: false,
      latestStatus: 'listed_active',
      latestListDay: TODAY,
      today: TODAY,
      expiredOwnerConfirmed: true,
      hasRelistCheckToday: true,
    })).toBe('listed_active')
    expect(marketExportBlock({
      enabled: true,
      expiredSourced: false,
      highPrice: true,
      ownerChanged: false,
      latestStatus: 'listed_active',
      latestListDay: TODAY,
      today: TODAY,
      expiredOwnerConfirmed: true,
      hasRelistCheckToday: true,
    })).toBe('active_high_price')
  })

  it('excludes avoid and parked zips even when the price is above the floor', () => {
    const csv = [
      'MLS #,St,Address,Zip,Close Dt,Expire Date,List Price,Parcel ID',
      '1,Active,1 Main St,64125,,,500000,A1',
      '2,Active,2 Main St,64131,,,500000,A2',
      '3,Expired,3 Main St,64125,,2026-11-01,100000,A3',
    ].join('\n')
    const result = plan(csv, [
      pool({ id: 'avoid', address: '1 Main St', zip5: '64125', parcelId: 'A1' }),
      pool({ id: 'parked', address: '2 Main St', zip5: '64131', parcelId: 'A2' }),
    ])
    expect(result.tags).toEqual([])
    expect(result.intakes).toEqual([])
  })

  it('holds expired rows for one owner-confirm switch and a same-day relist check', () => {
    const base = {
      enabled: true,
      expiredSourced: true,
      highPrice: false,
      ownerChanged: false,
      latestListDay: TODAY,
      today: TODAY,
      lineChecksMerged: true,
    }
    expect(marketExportBlock({
      ...base,
      latestStatus: 'listing_expired' as ListingStatus,
      expiredOwnerConfirmed: false,
      hasRelistCheckToday: false,
    })).toBe('expired_owner_confirm_pending')
    expect(marketExportBlock({
      ...base,
      latestStatus: 'listing_expired',
      expiredOwnerConfirmed: true,
      hasRelistCheckToday: false,
    })).toBe('relist_check_missing')
    expect(marketExportBlock({
      ...base,
      latestStatus: 'listed_active',
      expiredOwnerConfirmed: true,
      hasRelistCheckToday: true,
    })).toBe('listed_active')
    expect(marketExportBlock({
      ...base,
      latestStatus: 'listing_expired',
      expiredOwnerConfirmed: true,
      hasRelistCheckToday: true,
      lineChecksMerged: false,
    })).toBe('line_check_unknown')
    expect(marketExportBlock({
      ...base,
      latestStatus: 'listed_pending',
      expiredOwnerConfirmed: true,
      hasRelistCheckToday: true,
      lineChecksMerged: true,
    })).toBe('listed_pending')
  })

  it('leaves the market gate closed until MLS_MARKET_CHECK_ENABLED is on', () => {
    expect(marketExportBlock({
      enabled: false,
      expiredSourced: false,
      highPrice: true,
      ownerChanged: true,
      latestStatus: 'sold_new_owner',
      latestListDay: TODAY,
      today: TODAY,
      expiredOwnerConfirmed: false,
      hasRelistCheckToday: false,
    })).toBeNull()
  })

  it('marks Kansas rows unconfirmed and keeps expired disclosure on', () => {
    expect(ksLicenseUnconfirmed('KS')).toBe(true)
    expect(ksLicenseUnconfirmed('MO')).toBe(false)
    expect(requiresLicenseeDisclosure(true)).toBe(true)
    expect(requiresLicenseeDisclosure(false)).toBe(false)
  })

  it('blocks a sold row with no close date, a blank status, and a future expiration as unknown', () => {
    const csv = [
      'MLS #,St,Address,Zip,Close Dt,Expire Date,List Price,Parcel ID',
      '1,Sold,21 Oak St,64114,,,150000,U1',
      '2,,22 Oak St,64114,,,150000,U2',
      '3,Expired,23 Oak St,64114,,2026-12-01,150000,U3',
    ].join('\n')
    const result = plan(csv, [
      pool({ id: 'sold', address: '21 Oak St', zip5: '64114', parcelId: 'U1' }),
      pool({ id: 'blank', address: '22 Oak St', zip5: '64114', parcelId: 'U2' }),
      pool({ id: 'future', address: '23 Oak St', zip5: '64114', parcelId: 'U3' }),
    ])
    expect(result.checks.find((row) => row.parcelId === 'U1')?.listingStatus).toBe('listing_check_unknown')
    expect(result.checks.find((row) => row.parcelId === 'U2')?.listingStatus).toBe('listing_check_unknown')
    expect(result.checks.find((row) => row.parcelId === 'U3')?.listingStatus).toBe('listing_check_unknown')
    expect(result.intakes.some((row) => row.parcelId === 'U3')).toBe(false)
  })

  it('skips a Cass intake without aborting the other rows', () => {
    const csv = [
      'MLS #,St,Address,Zip,Close Dt,Expire Date,List Price,Parcel ID',
      '1,Expired,30 Oak St,64114,,2026-11-01,100000,C1',
    ].join('\n')
    const zips = new Map(targetMap())
    zips.set('64080', { zip5: '64080', county: 'cass', state: 'MO', status: 'keep' })
    const withCass = [
      csv,
      '2,Expired,31 Oak St,64080,,2026-11-01,100000,C2',
    ].join('\n')
    const result = planMarketCheck({
      rows: parseMatrixCsv(withCass),
      poolRows: [],
      targetStatusByZip: zips,
      minListPriceByZip: priceMap(),
      today: TODAY,
      additionListDay: TODAY,
      allowOffMarket: true,
      completeFile: true,
      hasExpireColumn: true,
      fileSha256: 'a'.repeat(64),
    })
    expect(result.intakes.map((row) => row.zip5)).toEqual(['64114'])
    expect(result.intakes[0]?.county).toBe('jackson')
    expect(result.skipped).toEqual([expect.objectContaining({ zip5: '64080', reason: 'out_of_service_area' })])
  })

  it('puts adds after the 4:00am Chicago lock on the next list', () => {
    const result = plan(FIXTURE, [], { additionListDay: '2026-11-15' })
    expect(result.intakes[0]?.listDay).toBe('2026-11-15')
  })

  it('keeps the higher status when a later row is expired or unmapped', () => {
    const header = 'MLS #,St,Address,Zip,Close Dt,Expire Date,List Price,Parcel ID'
    const activeThenExpired = [
      header,
      '1,Active,10 Oak St,64114,,,100000,P1',
      '2,Expired,10 Oak St,64114,,2026-11-01,100000,P1',
    ].join('\n')
    const pendingThenExpired = [
      header,
      '1,Pending,11 Oak St,64114,,,100000,P2',
      '2,Expired,11 Oak St,64114,,2026-11-01,100000,P2',
    ].join('\n')
    const activeThenUnmapped = [
      header,
      '1,Active,12 Oak St,64114,,,100000,P3',
      '2,Not A Status,12 Oak St,64114,,,100000,P3',
    ].join('\n')
    const pooled = (csv: string, id: string, parcelId: string, address: string) => plan(csv, [
      pool({ id, address, zip5: '64114', parcelId }),
    ])
    expect(pooled(activeThenExpired, 'a', 'P1', '10 Oak St').checks.find((row) => row.parcelId === 'P1')?.listingStatus).toBe('listed_active')
    expect(pooled(pendingThenExpired, 'p', 'P2', '11 Oak St').checks.find((row) => row.parcelId === 'P2')?.listingStatus).toBe('listed_pending')
    expect(pooled(activeThenUnmapped, 'u', 'P3', '12 Oak St').checks.find((row) => row.parcelId === 'P3')?.listingStatus).toBe('listed_active')
  })

  it('records unknown when the only Matrix row has an oversized DOM', () => {
    const csv = [
      'MLS #,St,Address,Zip,DOM,Parcel ID',
      '1,Active,20 Pine St,64114,20001,BIG',
    ].join('\n')
    const result = plan(csv, [pool({ id: 'big', address: '20 Pine St', zip5: '64114', parcelId: 'BIG' })])
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'dom_out_of_range', parcelId: 'BIG' })])
    expect(result.checks.find((row) => row.parcelId === 'BIG')?.listingStatus).toBe('listing_check_unknown')
  })
})

describe('Chicago market-check window', () => {
  it('covers both CST and CDT with the three UTC ticks', () => {
    expect(marketCheckWindow(new Date('2026-07-15T07:30:00Z'))).toBe('load')
    expect(marketCheckWindow(new Date('2026-07-15T08:30:00Z'))).toBe('deadline')
    expect(marketCheckWindow(new Date('2026-07-15T09:30:00Z'))).toBe('idle')
    expect(marketCheckWindow(new Date('2026-01-15T07:30:00Z'))).toBe('idle')
    expect(marketCheckWindow(new Date('2026-01-15T08:30:00Z'))).toBe('load')
    expect(marketCheckWindow(new Date('2026-01-15T09:30:00Z'))).toBe('deadline')
    expect(offMarketAllowed(new Date('2026-01-15T08:30:00Z'))).toBe(true)
    expect(offMarketAllowed(new Date('2026-01-15T09:30:00Z'))).toBe(false)
    expect(additionListDay(new Date('2026-01-15T09:59:00Z'))).toBe('2026-01-15')
    expect(additionListDay(new Date('2026-01-15T10:00:00Z'))).toBe('2026-01-16')
  })
})
