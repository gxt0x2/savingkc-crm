import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { matrixCsvHasExpireColumn, parseMatrixCsv, wholeDays } from '@/lib/market-check/matrix-csv'
import { NINETY_PLUS_BASIS, selectNinetyPlusDays } from '@/lib/market-check/ninety-plus'
import { planMarketCheck } from '@/lib/market-check/plan'
import { PRICE_THRESHOLDS, TARGET_ZIPS } from '@/lib/market-check/seeds'

const migration = readFileSync(
  join(process.cwd(), 'supabase/migrations/20261221120000_market_ninety_plus_days.sql'),
  'utf8',
)

const CSV = [
  'MLS #,St,Address,Zip,Exp Dt,Off Market Date,DOM,CDOM,List Price,Parcel ID,List Agent Full Name,List Agent Direct Work Phone,List Office Name',
  '2001,Active,40 Oak St,64114,2026-12-01,,120,140,180000,D1,Ada Agent,(816) 555-0100,Ada Realty',
  '2002,Pending,41 Oak St,64114,,,200,200,180000,D2,Bea Agent,816-555-0101,Bea Realty',
  '2003,Expired,42 Oak St,64114,2026-11-01,,200,200,180000,D3,Cara Agent,816-555-0102,Cara Realty',
  '2004,Withdrawn,43 Oak St,64114,,,10,90,180000,D4,Dee Agent,816-555-0199,Dee Realty',
  '2005,Under Contract,44 Oak St,64114,,,400,10,180000,D5,Eve Agent,816-555-0188,Eve Realty',
  '2006,Active,45 Oak St,66205,,,89,,180000,D6,Fay Agent,913-555-0100,Fay Realty',
  '2007,Active,46 Oak St,66102,,,100,40,180000,D7,Gia Agent,913-555-0190,Gia Realty',
  '2008,Active,47 Oak St,64114,,2026-10-01,95,10,180000,D8,Hal Agent,816-555-0177,Hal Realty',
].join('\n')

function planned() {
  return planMarketCheck({
    rows: parseMatrixCsv(CSV),
    poolRows: [],
    targetStatusByZip: new Map(TARGET_ZIPS.map((zip) => [zip.zip5, zip])),
    minListPriceByZip: new Map(PRICE_THRESHOLDS.map((row) => [row.zip5, row.minListPrice])),
    today: '2026-11-17',
    additionListDay: '2026-11-17',
    allowOffMarket: true,
    completeFile: true,
    hasExpireColumn: matrixCsvHasExpireColumn(CSV),
    fileSha256: 'b'.repeat(64),
  })
}

describe('Matrix DOM and expiration parsing', () => {
  it('reads DOM, CDOM, Exp Dt, Off Market Date, and the listing agent', () => {
    expect(wholeDays('120')).toBe(120)
    expect(wholeDays('90.0')).toBe(90)
    expect(wholeDays('90.5')).toBeNull()
    expect(wholeDays('')).toBeNull()
    expect(matrixCsvHasExpireColumn(CSV)).toBe(true)
    expect(matrixCsvHasExpireColumn('MLS #,St,Address,Zip\n1,Active,1 Oak St,64114')).toBe(false)

    const rows = parseMatrixCsv(CSV)
    const active = rows.find((row) => row.parcelId === 'D1')
    expect(active).toMatchObject({
      dom: 120,
      cdom: 140,
      expireDate: '2026-12-01',
      listingAgentName: 'Ada Agent',
      listingAgentPhone: '(816) 555-0100',
      listingOffice: 'Ada Realty',
    })
    expect(rows.find((row) => row.parcelId === 'D8')?.expireDate).toBe('2026-10-01')
    expect(rows.find((row) => row.parcelId === 'D6')).toMatchObject({
      dom: 89,
      cdom: null,
      listingAgentName: 'Fay Agent',
      listingAgentPhone: '913-555-0100',
    })
  })

  it('stores the parsed days and agent on the listing check', () => {
    const check = planned().checks.find((row) => row.parcelId === 'D1')
    expect(check).toMatchObject({
      listingStatus: 'listed_active',
      dom: 120,
      cdom: 140,
      expireDate: '2026-12-01',
      listingAgentName: 'Ada Agent',
      listingAgentPhone: '(816) 555-0100',
    })
  })
})

function lane(checks: ReturnType<typeof planned>['checks'], runDate = '2026-11-17') {
  return selectNinetyPlusDays(checks.map((check) => ({ ...check, checkedOn: check.listDay })), runDate)
}

describe('90+ Days selection', () => {
  it('keeps active and withdrawn listings at 90 days and drops pending and expired', () => {
    const selected = lane(planned().checks)
    const parcels = selected.map((item) => item.row.parcelId).sort()
    expect(parcels).toEqual(['D1', 'D4', 'D7', 'D8'])
    expect(selected.find((item) => item.row.parcelId === 'D4')).toMatchObject({
      requiresLicenseeDisclosure: true,
      basis: NINETY_PLUS_BASIS,
      row: {
        listingStatus: 'listed_withdrawn',
        dom: 10,
        cdom: 90,
        listingAgentName: 'Dee Agent',
        listingAgentPhone: '816-555-0199',
        listingOffice: 'Dee Realty',
      },
    })
    expect(selected.find((item) => item.row.parcelId === 'D1')?.row.listingOffice).toBe('Ada Realty')
    expect(selected.find((item) => item.row.parcelId === 'D7')?.row.listingStatus).toBe('listed_active')
    expect(selected.some((item) => item.row.listingStatus === 'listed_pending')).toBe(false)
    expect(selected.some((item) => item.row.listingStatus === 'listing_expired')).toBe(false)
    expect(planned().checks.find((row) => row.parcelId === 'D3')?.listingStatus).toBe('listing_expired')
    expect(planned().intakes.map((row) => row.parcelId)).toEqual(['D3'])
  })

  it('keeps only today, and an unmapped latest row stays out of the lane', () => {
    const active = {
      propertyKey: 'parcel:P1',
      listingStatus: 'listed_active' as const,
      dom: 120,
      cdom: null,
      checkedOn: '2026-11-16',
      listingOffice: 'Old Realty',
    }
    expect(selectNinetyPlusDays([active], '2026-11-17')).toEqual([])
    expect(selectNinetyPlusDays([{ ...active, checkedOn: '2026-11-17' }], '2026-11-17')).toHaveLength(1)
    const replaced = selectNinetyPlusDays([
      { ...active, checkedOn: '2026-11-17' },
      { ...active, listingStatus: 'listing_check_unknown', checkedOn: '2026-11-17' },
    ], '2026-11-17')
    expect(replaced).toEqual([])
    expect(selectNinetyPlusDays([
      { ...active, checkedOn: '2026-11-17', listingStatus: 'listed_pending' },
    ], '2026-11-17')).toEqual([])
    const csv = [
      'MLS #,St,Address,Zip,DOM,Parcel ID',
      '1,Active,40 Oak St,64114,120,P1',
      '2,Not A Status,40 Oak St,64114,120,P1',
    ].join('\n')
    const stored = planMarketCheck({
      rows: parseMatrixCsv(csv),
      poolRows: [],
      targetStatusByZip: new Map(TARGET_ZIPS.map((zip) => [zip.zip5, zip])),
      minListPriceByZip: new Map(PRICE_THRESHOLDS.map((row) => [row.zip5, row.minListPrice])),
      today: '2026-11-17',
      additionListDay: '2026-11-17',
      allowOffMarket: true,
      completeFile: true,
      hasExpireColumn: false,
      fileSha256: 'd'.repeat(64),
    })
    expect(stored.checks.find((check) => check.parcelId === 'P1')?.listingStatus).toBe('listed_active')
  })
})

describe('oversized DOM', () => {
  it('rejects that row and keeps the rest of the file', () => {
    const csv = [
      'MLS #,St,Address,Zip,DOM,Parcel ID',
      '1,Active,40 Oak St,64114,20001,BIG',
      '2,Active,41 Oak St,64114,90,OK',
    ].join('\n')
    const rows = parseMatrixCsv(csv)
    expect(rows.find((row) => row.parcelId === 'BIG')).toMatchObject({ dom: null, daysOutOfRange: true })
    const result = planMarketCheck({
      rows,
      poolRows: [],
      targetStatusByZip: new Map(TARGET_ZIPS.map((zip) => [zip.zip5, zip])),
      minListPriceByZip: new Map(PRICE_THRESHOLDS.map((row) => [row.zip5, row.minListPrice])),
      today: '2026-11-17',
      additionListDay: '2026-11-17',
      allowOffMarket: true,
      completeFile: true,
      hasExpireColumn: false,
      fileSha256: 'c'.repeat(64),
    })
    expect(result.skipped).toEqual([expect.objectContaining({ reason: 'dom_out_of_range', parcelId: 'BIG' })])
    expect(result.checks.map((check) => check.parcelId)).toEqual(['OK'])
    expect(result.checks[0]?.dom).toBe(90)
  })
})

describe('KS expired release audit', () => {
  it('leaves the flag false and audits a raise that matches the citation placeholder', () => {
    expect(migration).toContain("('KS_EXPIRED_RELEASE_APPROVED', 'false')")
    expect(migration).toContain("('KS_EXPIRED_RELEASE_CITATION', 'OWNER-2026-11-17-0710-CT')")
    const raiseStart = migration.indexOf('FUNCTION public.record_mls_ks_expired_release_v1')
    const raiseBody = migration.slice(raiseStart, migration.indexOf('$function$;', raiseStart))
    expect(raiseBody.indexOf('mls_market_flag_citation_required')).toBeLessThan(
      raiseBody.indexOf('INSERT INTO public.mls_market_flag_changes'),
    )
    expect(raiseBody).toContain('INSERT INTO public.mls_market_flag_changes (flag_key, new_value, citation, actor)')
    expect(raiseBody).toContain("'KS_EXPIRED_RELEASE_APPROVED'")
    expect(raiseBody).toContain('btrim(p_citation)')
    expect(raiseBody).toContain("btrim(p_citation) = 'EXC-2026-11-14-003'")
    expect(raiseBody).toContain('KS_EXPIRED_RELEASE_CITATION')
    expect(migration).not.toMatch(/PERFORM\s+public\.record_mls_ks_expired_release_v1/)
    expect(migration).not.toMatch(/SELECT\s+public\.record_mls_ks_expired_release_v1/)

    const laneStart = migration.indexOf('VIEW public.market_ninety_plus_days_v1')
    const lane = migration.slice(laneStart, migration.indexOf('COMMENT ON VIEW public.market_ninety_plus_days_v1'))
    expect(lane).toContain("'listed_active', 'listed_withdrawn'")
    expect(lane).toContain("status.listing_status IS DISTINCT FROM 'listed_pending'")
    expect(lane).toContain("status.listing_status IS DISTINCT FROM 'listing_expired'")
    expect(lane).toContain('status.dom >= 90 OR status.cdom >= 90')
    expect(lane).toContain('status.listing_agent_name')
    expect(lane).toContain('status.listing_agent_phone')
    expect(lane).toContain('status.listing_office')
    expect(lane).toContain('requires_licensee_disclosure')
    expect(lane).toContain("'owner_ruling_2026-11-17_listing_agent'")
    expect(lane).toContain("timezone('America/Chicago', status.checked_at)")
    expect(lane).toContain("'listing_check_unknown'")
    expect(lane).toContain("'listing_agent'")
    expect(migration).toContain("'dom_out_of_range'")
    expect(lane).not.toContain('ks_license')
    expect(migration).toContain('keyed.dom')
    expect(migration).toContain('keyed.expire_date')
    expect(migration).not.toContain('market_calling_window_open_v1')
    expect(migration).not.toContain('source_list_row_status_history_to_check')
    expect(migration).not.toContain('0900_1900')
  })
})
