import { describe, expect, it } from 'vitest'
import {
  FORECLOSURE_INTAKE_SOURCES,
  appendIntakeNotice,
  automaticLoadAllowed,
  bestIntakeMatch,
  equityEnrichmentHook,
  extractZip,
  matchDisposition,
  foreclosureIntakeOutreachBlockers,
  intakeRowsReachableForDialerOrExport,
  intakeSourceAcceptsRows,
  matchIntakeSourceDefinition,
  normalizePartyName,
  normalizeStreetAddress,
  openingTimeline,
  prepareIntakeRow,
  presentIngestControls,
  splitPropertyAddress,
  type IntakeMatchCandidate,
  type PreparedIntake,
} from '@/lib/prospecting/foreclosure-intake'
import { callingListExportDay, liveFilingSalePatch, preExportFilter } from '@/lib/prospecting/foreclosure-intake-gates'

const enabled = { enabled: true }
const running = { paused: false }
const paused = { paused: true }

function row(overrides: Record<string, unknown> = {}) {
  return {
    state: 'MO',
    county: 'Jackson',
    source: 'Case.net',
    case_number_or_notice_id: '2416-CV01234',
    filing_or_notice_date: '2026-11-01',
    sale_date: '2026-12-01',
    property_address: '100 Sample Lane, Kansas City, MO 64108',
    owner_or_defendant: 'Sample Homeowner',
    plaintiff_or_trustee_firm: 'Sample Trustee LLC',
    stage: 'Lis Pendens',
    source_url: 'https://example.com/casenet/sample',
    parcel_id: 'PARCEL-100',
    ...overrides,
  }
}

function prepared(overrides: Record<string, unknown> = {}, control: { paused: boolean } | null = running): PreparedIntake {
  const result = prepareIntakeRow(row(overrides), enabled, control, '2026-11-14')
  if (!result.ok) throw new Error(result.reason)
  return result.record
}

function candidate(overrides: Partial<IntakeMatchCandidate> = {}): IntakeMatchCandidate {
  return {
    id: 'intake-1',
    kind: 'intake',
  parcelId: null,
  addressKey: null,
  zip: null,
  unitKey: null,
  ownerKey: null,
    trusteeKey: null,
    saleDate: null,
    noticeKey: null,
    ownerName: 'Someone Else',
    situs: '200 Other Street',
    timeline: [],
    sourceName: 'Case.net',
    stage: 'Lis Pendens',
    sourceUrl: 'https://example.com/prior',
    reviewStatus: 'pending',
    ...overrides,
  }
}

describe('foreclosure intake sources', () => {
  it('keeps free sources enabled by default and paid sources present but off', () => {
    const byKey = new Map(FORECLOSURE_INTAKE_SOURCES.map((source) => [source.key, source]))
    for (const key of ['casenet', 'daily_record', 'noticeregistry', 'southlaw', 'millsap_singer', 'logs_missouri', 'ks_efiling', 'ks_sheriff_lists']) {
      expect(byKey.get(key)).toMatchObject({ isPaid: false, enabledByDefault: true })
    }
    expect(byKey.get('mopublicnotices_smart_search')).toMatchObject({ isPaid: true, enabledByDefault: false, priceNote: '$75/30 days' })
    expect(byKey.get('mlm_foreclosure_property_plus')).toMatchObject({ isPaid: true, enabledByDefault: false })
    expect(byKey.get('trusteesaledata_pro')).toMatchObject({ isPaid: true, enabledByDefault: false })
    expect(byKey.get('propertyradar')).toMatchObject({ isPaid: true, enabledByDefault: false })
    expect(FORECLOSURE_INTAKE_SOURCES.filter((source) => source.isPaid && source.enabledByDefault)).toEqual([])
  })

  it('rejects a disabled source and a source that is not in the registry', () => {
    expect(matchIntakeSourceDefinition('mopublicnotices')?.key).toBe('mopublicnotices_smart_search')
    expect(intakeSourceAcceptsRows({ enabled: false })).toBe(false)
    expect(intakeSourceAcceptsRows(null)).toBe(false)
    const paid = prepareIntakeRow(row({ source: 'PropertyRadar', parcel_id: '' }), { enabled: false }, running, '2026-11-14')
    expect(paid.ok).toBe(false)
    if (!paid.ok) expect(paid.code).toBe('source_disabled')
    const unknown = prepareIntakeRow(row({ source: 'Some Other Feed' }), enabled, running, '2026-11-14')
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.code).toBe('unknown_source')
  })

  it('fails closed when the county control is missing or paused', () => {
    expect(automaticLoadAllowed(null)).toBe(false)
    expect(automaticLoadAllowed(paused)).toBe(false)
    expect(automaticLoadAllowed(running)).toBe(true)
    const missing = prepareIntakeRow(row(), enabled, null, '2026-11-14')
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.code).toBe('ingest_paused')
    const held = prepareIntakeRow(row({ county: 'Wyandotte', state: 'KS', source: 'Johnson sheriff' }), enabled, paused, '2026-11-14')
    expect(held.ok).toBe(false)
    const shown = presentIngestControls([])
    expect(shown).toHaveLength(20)
    expect(shown.every((item) => item.paused)).toBe(true)
  })
})

describe('foreclosure intake matching', () => {
  it('matches parcel id before a different address', () => {
    const incoming = prepared()
    const match = bestIntakeMatch(incoming, [
      candidate({ id: 'address', addressKey: incoming.addressKey, zip: incoming.zip, parcelId: 'OTHER' }),
      candidate({ id: 'parcel', parcelId: 'PARCEL100' }),
    ])
    expect(match).toMatchObject({ tier: 'parcel_id', candidate: { id: 'parcel' } })
  })

  it('matches normalized street address plus zip when parcel id is absent', () => {
    const incoming = prepared({ parcel_id: '', property_address: '100 Sample Street, Kansas City, MO 64108' })
    expect(incoming.addressKey).toBe(normalizeStreetAddress('100 Sample St'))
    expect(extractZip(incoming.propertyAddress)).toBe('64108')
    const match = bestIntakeMatch(incoming, [
      candidate({ id: 'street', addressKey: '100 sample st', zip: '64108' }),
      candidate({ id: 'other-zip', addressKey: '100 sample st', zip: '64111' }),
    ])
    expect(match).toMatchObject({ tier: 'address_zip', candidate: { id: 'street' } })
  })

  it('matches owner, trustee, and sale date only when the property also agrees', () => {
    const incoming = prepared({
      parcel_id: '',
      property_address: '100 Sample Street, Kansas City, MO 64108',
      owner_or_defendant: 'Homeowner, Sample',
      plaintiff_or_trustee_firm: 'Sample Trustee, LLC',
      sale_date: '2026-12-01',
    })
    expect(normalizePartyName('Homeowner, Sample')).toBe('sample homeowner')
    const match = bestIntakeMatch(incoming, [
      candidate({
        id: 'party',
        addressKey: '100 sample st',
        zip: '64108',
        unitKey: null,
        ownerKey: 'sample homeowner',
        trusteeKey: 'sample trustee llc',
        saleDate: '2026-12-01',
      }),
    ])
    expect(match).toMatchObject({ tier: 'owner_trustee_sale', candidate: { id: 'party' } })
  })

  it('flags owner, trustee, and sale date across two addresses instead of merging', () => {
    const incoming = prepared({
      parcel_id: '',
      property_address: '100 Main St, Kansas City, MO 64108',
      owner_or_defendant: 'Sample Homeowner',
      plaintiff_or_trustee_firm: 'Sample Trustee LLC',
      sale_date: '2026-12-01',
    })
    const other = candidate({
      id: 'other-house',
      addressKey: '200 oak ave',
      zip: '64111',
      ownerKey: incoming.ownerKey,
      trusteeKey: incoming.trusteeKey,
      saleDate: '2026-12-01',
    })
    expect(bestIntakeMatch(incoming, [other])).toBeNull()
    expect(matchDisposition(incoming, other)).toBe('possible_match')
  })

  it('uses the case or notice number only when the property agrees', () => {
    const incoming = prepared({
      parcel_id: '',
      property_address: '100 Sample Street, Kansas City, MO 64108',
      sale_date: '2026-12-15',
    })
    const match = bestIntakeMatch(incoming, [
      candidate({
        id: 'case',
        noticeKey: incoming.noticeKey,
        addressKey: '100 sample st',
        zip: '64108',
        saleDate: '2026-12-01',
      }),
    ])
    expect(match).toMatchObject({ tier: 'case_or_notice', candidate: { id: 'case' } })
  })

  it('does not merge the same case id on two properties', () => {
    const incoming = prepared({
      parcel_id: '',
      property_address: '100 Main St, Kansas City, MO 64108',
    })
    const other = candidate({
      id: 'other-case',
      noticeKey: incoming.noticeKey,
      addressKey: '200 oak ave',
      zip: '64111',
    })
    expect(bestIntakeMatch(incoming, [other])).toBeNull()
    expect(matchDisposition(incoming, other)).toBe('identity_conflict')
  })

  it('does not merge bare units 4B and 4 when owner, trustee, case, and sale differ', () => {
    const unit4b = '100 Sample Ln, 4B, Kansas City, MO 64108'
    const unit4 = '100 Sample Ln, 4, Kansas City, MO 64108'
    expect(splitPropertyAddress(unit4b)).toEqual({ street: '100 sample ln', unit: '4b' })
    expect(splitPropertyAddress(unit4)).toEqual({ street: '100 sample ln', unit: '4' })
    const incoming = prepared({
      parcel_id: '',
      property_address: unit4b,
      owner_or_defendant: 'Owner A',
      plaintiff_or_trustee_firm: 'Trustee A',
      case_number_or_notice_id: 'CASE-A',
      sale_date: '2026-12-01',
    })
    const other = prepared({
      parcel_id: '',
      property_address: unit4,
      owner_or_defendant: 'Owner B',
      plaintiff_or_trustee_firm: 'Trustee B',
      case_number_or_notice_id: 'CASE-B',
      sale_date: '2026-12-15',
    })
    expect(bestIntakeMatch(incoming, [
      candidate({
        id: 'unit-4',
        addressKey: other.addressKey,
        zip: other.zip,
        unitKey: other.unitKey,
        ownerKey: other.ownerKey,
        trusteeKey: other.trusteeKey,
        noticeKey: other.noticeKey,
        saleDate: other.saleDate,
      }),
    ])).toBeNull()
    expect(matchDisposition(incoming, candidate({
      addressKey: other.addressKey,
      zip: other.zip,
      unitKey: other.unitKey,
      ownerKey: other.ownerKey,
      trusteeKey: other.trusteeKey,
      noticeKey: other.noticeKey,
      saleDate: other.saleDate,
    }))).toBeNull()
  })

  it('does not merge a bare unit 4 with the same street and no unit', () => {
    const withUnit = '100 Sample Ln, 4, Kansas City, MO 64108'
    const noUnit = '100 Sample Ln, Kansas City, MO 64108'
    expect(splitPropertyAddress(withUnit).unit).toBe('4')
    expect(splitPropertyAddress(noUnit).unit).toBeNull()
    const incoming = prepared({ parcel_id: '', property_address: noUnit })
    const other = prepared({ parcel_id: '', property_address: withUnit })
    expect(bestIntakeMatch(incoming, [
      candidate({ id: 'with-unit', addressKey: other.addressKey, zip: other.zip, unitKey: other.unitKey }),
    ])).toBeNull()
    expect(bestIntakeMatch(other, [
      candidate({ id: 'no-unit', addressKey: incoming.addressKey, zip: incoming.zip, unitKey: incoming.unitKey }),
    ])).toBeNull()
  })

  it('still matches when the bare unit is the same', () => {
    const incoming = prepared({ parcel_id: '', property_address: '100 Sample Ln, 4B, Kansas City, MO 64108' })
    expect(incoming.unitKey).toBe('4b')
    expect(bestIntakeMatch(incoming, [
      candidate({ id: 'same-unit', addressKey: incoming.addressKey, zip: incoming.zip, unitKey: '4b' }),
    ])).toMatchObject({ tier: 'address_zip', candidate: { id: 'same-unit' } })
  })

  it('does not merge single-letter units A and B', () => {
    const unitA = '100 Sample Ln, A, Kansas City, MO 64108'
    const unitB = '100 Sample Ln, B, Kansas City, MO 64108'
    expect(splitPropertyAddress(unitA)).toEqual({ street: '100 sample ln', unit: 'a' })
    expect(splitPropertyAddress(unitB).unit).toBe('b')
    const incoming = prepared({
      parcel_id: '',
      property_address: unitA,
      owner_or_defendant: 'Owner A',
      plaintiff_or_trustee_firm: 'Trustee A',
      case_number_or_notice_id: 'CASE-A',
      sale_date: '2026-12-01',
    })
    const other = prepared({
      parcel_id: '',
      property_address: unitB,
      owner_or_defendant: 'Owner B',
      plaintiff_or_trustee_firm: 'Trustee B',
      case_number_or_notice_id: 'CASE-B',
      sale_date: '2026-12-15',
    })
    expect(bestIntakeMatch(incoming, [
      candidate({
        id: 'unit-b',
        addressKey: other.addressKey,
        zip: other.zip,
        unitKey: other.unitKey,
        ownerKey: other.ownerKey,
        trusteeKey: other.trusteeKey,
        noticeKey: other.noticeKey,
        saleDate: other.saleDate,
      }),
    ])).toBeNull()
  })

  it('does not merge a single-letter unit with the same street and no unit', () => {
    const withUnit = '100 Sample Ln, A, Kansas City, MO 64108'
    const noUnit = '100 Sample Ln, Kansas City, MO 64108'
    expect(splitPropertyAddress(withUnit).unit).toBe('a')
    expect(splitPropertyAddress(noUnit).unit).toBeNull()
    const incoming = prepared({ parcel_id: '', property_address: noUnit })
    const other = prepared({ parcel_id: '', property_address: withUnit })
    expect(bestIntakeMatch(incoming, [
      candidate({ id: 'with-letter', addressKey: other.addressKey, zip: other.zip, unitKey: other.unitKey }),
    ])).toBeNull()
    expect(bestIntakeMatch(other, [
      candidate({ id: 'no-letter', addressKey: incoming.addressKey, zip: incoming.zip, unitKey: incoming.unitKey }),
    ])).toBeNull()
  })

  it('does not merge condo units 1204 and 1502 when owner, trustee, case, and sale differ', () => {
    const unit1204 = '600 Sample Blvd, 1204, Kansas City, MO 64105'
    const unit1502 = '600 Sample Blvd, 1502, Kansas City, MO 64105'
    expect(splitPropertyAddress(unit1204)).toEqual({ street: '600 sample blvd', unit: '1204' })
    expect(splitPropertyAddress(unit1502).unit).toBe('1502')
    expect(splitPropertyAddress('600 Sample Blvd, 64105, Kansas City, MO 64105').unit).toBeNull()
    const incoming = prepared({
      parcel_id: '',
      property_address: unit1204,
      owner_or_defendant: 'Owner A',
      plaintiff_or_trustee_firm: 'Trustee A',
      case_number_or_notice_id: 'CASE-A',
      sale_date: '2026-12-01',
    })
    const other = prepared({
      parcel_id: '',
      property_address: unit1502,
      owner_or_defendant: 'Owner B',
      plaintiff_or_trustee_firm: 'Trustee B',
      case_number_or_notice_id: 'CASE-B',
      sale_date: '2026-12-15',
    })
    expect(bestIntakeMatch(incoming, [
      candidate({
        id: 'unit-1502',
        addressKey: other.addressKey,
        zip: other.zip,
        unitKey: other.unitKey,
        ownerKey: other.ownerKey,
        trusteeKey: other.trusteeKey,
        noticeKey: other.noticeKey,
        saleDate: other.saleDate,
      }),
    ])).toBeNull()
  })

  it('does not merge condo unit 1204 with the same address and no unit', () => {
    const withUnit = '600 Sample Blvd, 1204, Kansas City, MO 64105'
    const noUnit = '600 Sample Blvd, Kansas City, MO 64105'
    const incoming = prepared({ parcel_id: '', property_address: withUnit })
    const other = prepared({ parcel_id: '', property_address: noUnit })
    expect(incoming.unitKey).toBe('1204')
    expect(other.unitKey).toBeNull()
    expect(bestIntakeMatch(incoming, [
      candidate({ id: 'no-unit', addressKey: other.addressKey, zip: other.zip, unitKey: other.unitKey }),
    ])).toBeNull()
    expect(bestIntakeMatch(other, [
      candidate({ id: 'unit-1204', addressKey: incoming.addressKey, zip: incoming.zip, unitKey: incoming.unitKey }),
    ])).toBeNull()
  })

  it('does not copy a 1502 sale onto a live 1204 filing', () => {
    const decision = liveFilingSalePatch({
      ownerName: 'Sample Homeowner',
      situs: '600 Sample Blvd, 1204, Kansas City, MO 64105',
      parcelId: 'PARCEL-600',
      zip: '64105',
      saleDate: '2026-12-01',
      saleStatus: 'scheduled',
    }, {
      ownerName: 'Sample Homeowner',
      propertyAddress: '600 Sample Blvd, 1502, Kansas City, MO 64105',
      parcelId: 'PARCEL-600',
      zip: '64105',
      saleDate: '2026-12-15',
      saleStatus: 'postponed',
    })
    expect(decision).toEqual({ ok: false, code: 'identity_conflict' })
  })

  it('keeps different units on the same street from merging', () => {
    const apt2 = prepared({ parcel_id: '', property_address: '100 Main St, Apt 2, Kansas City, MO 64108' })
    const apt3 = prepared({ parcel_id: '', property_address: '100 Main St, Apt 3, Kansas City, MO 64108' })
    expect(apt2.addressKey).toBe('100 main st')
    expect(apt2.unitKey).toBe('2')
    expect(apt3.unitKey).toBe('3')
    expect(bestIntakeMatch(apt2, [
      candidate({ id: 'apt-3', addressKey: apt3.addressKey, zip: '64108', unitKey: '3' }),
    ])).toBeNull()
  })

  it('does not merge a shared parcel when the units differ', () => {
    const incoming = prepared({ parcel_id: 'PARCEL-100', property_address: '100 Main St, Apt 2, Kansas City, MO 64108' })
    const other = candidate({ id: 'apt-3', parcelId: 'PARCEL100', addressKey: '100 main st', zip: '64108', unitKey: '3' })
    expect(matchDisposition(incoming, other)).toBe('identity_conflict')
    expect(bestIntakeMatch(incoming, [other])).toBeNull()
  })

  it('does not overwrite address, parcel, or owner on a live filing', () => {
    const existing = {
      ownerName: 'Sample Homeowner',
      situs: '100 Main St, Kansas City, MO 64108',
      parcelId: 'PARCEL-100',
      zip: '64108',
      saleDate: '2026-12-01',
      saleStatus: 'scheduled',
    }
    const conflict = liveFilingSalePatch(existing, {
      ownerName: 'Another Owner',
      propertyAddress: '200 Oak Ave, Kansas City, MO 64111',
      parcelId: 'OTHER',
      zip: '64111',
      saleDate: '2026-12-15',
      saleStatus: 'scheduled',
    })
    expect(conflict).toEqual({ ok: false, code: 'identity_conflict' })
    const patch = liveFilingSalePatch(existing, {
      ownerName: 'Sample Homeowner',
      propertyAddress: '100 Main St, Kansas City, MO 64108',
      parcelId: 'PARCEL-100',
      zip: '64108',
      saleDate: '2026-12-15',
      saleStatus: 'postponed',
    })
    expect(patch).toEqual({ ok: true, patch: { sale_date: '2026-12-15', sale_status: 'postponed' } })
    if (patch.ok) {
      expect(Object.keys(patch.patch).sort()).toEqual(['sale_date', 'sale_status'])
    }
  })

  it('does not match the Ernest Dodson sandbox filing', () => {
    const incoming = prepared({ owner_or_defendant: 'Ernest Dodson', parcel_id: 'SANDBOXPARCEL001', property_address: '100 Sandbox Court, Kansas City, MO 64108' })
    const match = bestIntakeMatch(incoming, [
      candidate({
        id: 'sandbox',
        kind: 'filing',
        ownerName: 'Ernest Dodson',
        situs: '100 Sandbox Court',
        parcelId: 'SANDBOXPARCEL001',
      }),
    ])
    expect(match).toBeNull()
  })

  it('appends a timeline event instead of treating the pull as a new identity', () => {
    const existing = openingTimeline(prepared({ sale_date: '2026-12-01' }))
    const appended = appendIntakeNotice({
      timeline: existing,
      saleDate: '2026-12-01',
      sourceName: 'Case.net',
      stage: 'Lis Pendens',
      sourceUrl: 'https://example.com/casenet/sample',
    }, {
      date: '2026-11-08',
      source: 'Daily Record public notices',
      stage: 'Notice of sale',
      saleDate: '2026-12-01',
      url: 'https://example.com/daily-record/sample',
    })
    expect(appended.duplicate).toBe(false)
    expect(appended.timeline).toHaveLength(2)
    expect(appended.timeline[1]).toMatchObject({ date: '2026-11-08', source: 'Daily Record public notices', sale_date: '2026-12-01' })
  })

  it('keeps the prior sale date when a notice is republished', () => {
    const first = openingTimeline(prepared({ sale_date: '2026-12-01' }))
    const republish = appendIntakeNotice({
      timeline: first,
      saleDate: '2026-12-01',
      sourceName: 'Daily Record public notices',
      stage: 'Notice of sale',
      sourceUrl: 'https://example.com/notice/1',
    }, {
      date: '2026-11-10',
      source: 'Daily Record public notices',
      stage: 'Notice of sale',
      saleDate: '2026-12-15',
      url: 'https://example.com/notice/2',
    })
    expect(republish.republished).toBe(true)
    expect(republish.saleDate).toBe('2026-12-15')
    expect(republish.timeline.map((event) => event.sale_date)).toEqual(['2026-12-01', '2026-12-15'])
  })

  it('leaves confirmation and equity empty when the pull does not say', () => {
    const court = prepared()
    expect(court.courtConfirmed).toBe(true)
    expect(court.recorderConfirmed).toBeNull()
    expect(court.equityBand).toBeNull()
    const sheriff = prepared({
      state: 'KS',
      county: 'Johnson',
      source: 'Wyandotte sheriff',
      stage: 'Sheriff sale',
      case_number_or_notice_id: 'SALE-9',
    })
    expect(sheriff.courtConfirmed).toBeNull()
    expect(sheriff.recorderConfirmed).toBeNull()
    expect(sheriff.noticeType).toBe('sheriff_sale')
    expect(sheriff.saleStatus).toBe('scheduled')
    expect(equityEnrichmentHook({ parcelId: null, propertyAddress: null, zip: null })).toEqual({ equityBand: null })
  })
})

describe('foreclosure intake dialer and export gate', () => {
  const pending = {
    reviewStatus: 'pending' as const,
    state: 'MO',
    county: 'jackson',
    dnc: false,
    optedOut: false,
    ksLicenseConfirmed: true,
  }

  it('keeps a pending row off the dialer and the export', () => {
    expect(foreclosureIntakeOutreachBlockers(pending)).toContain('intake_not_approved')
    expect(intakeRowsReachableForDialerOrExport([pending])).toEqual([])
  })

  it('still applies do-not-call and opt-out, and a Kansas row stays eligible', () => {
    expect(foreclosureIntakeOutreachBlockers({ ...pending, reviewStatus: 'approved', dnc: true })).toContain('do_not_call')
    expect(foreclosureIntakeOutreachBlockers({ ...pending, reviewStatus: 'approved', optedOut: true })).toContain('sms_opt_out')
    const kansas = {
      reviewStatus: 'approved' as const,
      state: 'KS',
      county: 'johnson',
      dnc: false,
      optedOut: false,
      ksLicenseConfirmed: false,
    }
    expect(foreclosureIntakeOutreachBlockers(kansas)).toEqual([])
    expect(intakeRowsReachableForDialerOrExport([kansas])).toEqual([kansas])
    expect(foreclosureIntakeOutreachBlockers({ ...kansas, dnc: true })).toContain('do_not_call')
    expect(intakeRowsReachableForDialerOrExport([{
      reviewStatus: 'rejected',
      state: 'MO',
      county: 'clay',
      dnc: false,
      optedOut: false,
      ksLicenseConfirmed: true,
    }])).toEqual([])
  })

  it('keeps only Jackson, Clay, Platte, Johnson, and Wyandotte', () => {
    const rejected = ['Cass County', 'CASS', 'Leavenworth', 'Leavenworth County', '', '   ', 'unknown', 'Unknown County']
    for (const county of rejected) {
      const result = prepareIntakeRow(row({ county, parcel_id: '' }), enabled, running, '2026-11-14')
      expect(result.ok, county || '(blank)').toBe(false)
      if (!result.ok) {
        const outside = county.trim().toLowerCase() !== '' && !county.toLowerCase().includes('unknown')
        expect(result.code).toBe(outside ? 'outside_service_area' : 'county_required')
      }
    }
    const accepted: Array<[string, string, 'MO' | 'KS']> = [
      ['Jackson', 'MO', 'MO'],
      ['JACKSON COUNTY', 'MO', 'MO'],
      ['Clay', 'MO', 'MO'],
      ['Platte County', 'MO', 'MO'],
      ['johnson', 'KS', 'KS'],
      ['Wyandotte County', 'KS', 'KS'],
      ['Wyandotte Co.', '', 'KS'],
      ['Johnson County, KS', '', 'KS'],
    ]
    for (const [county, state, expectedState] of accepted) {
      const result = prepareIntakeRow(row({ county, state }), enabled, running, '2026-11-14')
      expect(result.ok, county).toBe(true)
      if (result.ok) {
        expect(result.record.state, county).toBe(expectedState)
      }
    }
  })

  it('rejects a state that does not belong to the county and rejects compound counties', () => {
    const rejected = [
      { county: 'Johnson County', state: 'MO', code: 'outside_service_area' },
      { county: 'Jackson County', state: 'KS', code: 'outside_service_area' },
      { county: 'Johnson', state: '', code: 'state_required' },
      { county: 'Clay', state: '', code: 'state_required' },
      { county: 'Johnson County, MO', state: '', code: 'outside_service_area' },
      { county: 'Jackson County, KS', state: '', code: 'outside_service_area' },
      { county: 'Jackson/Cass', state: 'MO', code: 'outside_service_area' },
      { county: 'Cass County (near Jackson)', state: 'MO', code: 'outside_service_area' },
    ]
    for (const sample of rejected) {
      const result = prepareIntakeRow(row({ county: sample.county, state: sample.state, parcel_id: '' }), enabled, running, '2026-11-14')
      expect(result.ok, sample.county).toBe(false)
      if (!result.ok) expect(result.code).toBe(sample.code)
    }
    const qualified = prepareIntakeRow(row({ county: 'Johnson', state: 'KS' }), enabled, running, '2026-11-14')
    expect(qualified.ok).toBe(true)
    if (qualified.ok) {
      expect(qualified.record.county).toBe('johnson')
      expect(qualified.record.state).toBe('KS')
    }
    const unqualified = prepareIntakeRow(row({ county: 'Johnson', state: '' }), enabled, running, '2026-11-14')
    expect(unqualified.ok).toBe(false)
    if (!unqualified.ok) expect(unqualified.code).toBe('state_required')
    const johnsonMo = prepareIntakeRow(row({ county: 'Johnson', state: 'MO' }), enabled, running, '2026-11-14')
    expect(johnsonMo.ok).toBe(false)
    if (!johnsonMo.ok) expect(johnsonMo.code).toBe('outside_service_area')
  })

  it('keeps an approval after the 4:00am CT lock off that day\'s export', () => {
    const beforeLock = new Date('2026-11-14T09:30:00.000Z')
    const atLock = new Date('2026-11-14T10:00:00.000Z')
    expect(callingListExportDay(beforeLock)).toBe('2026-11-14')
    expect(callingListExportDay(atLock)).toBe('2026-11-15')
    const now = new Date('2026-11-14T14:00:00.000Z')
    const rows = preExportFilter([
      { reviewStatus: 'approved' as const, approvedAt: beforeLock.toISOString(), state: 'MO', county: 'jackson', dnc: false, optedOut: false, ksLicenseConfirmed: true },
      { reviewStatus: 'approved' as const, approvedAt: atLock.toISOString(), state: 'MO', county: 'jackson', dnc: false, optedOut: false, ksLicenseConfirmed: true },
    ], now)
    expect(rows.map((row) => row.approvedAt)).toEqual([beforeLock.toISOString()])
  })

  it('drops Cass, Leavenworth, blank, and unknown before export', () => {
    const now = new Date('2026-11-14T14:00:00.000Z')
    const approvedAt = new Date('2026-11-14T09:30:00.000Z').toISOString()
    const base = {
      reviewStatus: 'approved' as const,
      approvedAt,
      state: 'MO',
      dnc: false,
      optedOut: false,
      ksLicenseConfirmed: true,
    }
    const rows = preExportFilter([
      { ...base, county: 'jackson', id: 'jackson' },
      { ...base, county: 'Cass County', id: 'cass' },
      { ...base, county: 'Leavenworth', id: 'leavenworth' },
      { ...base, county: 'Leavenworth County', id: 'leavenworth-county' },
      { ...base, county: '', id: 'blank' },
      { ...base, county: null, id: 'missing' },
      { ...base, county: 'unknown', id: 'unknown' },
      { ...base, county: 'JOHNSON COUNTY', state: 'KS', id: 'johnson' },
    ], now)
    expect(rows.map((row) => row.id)).toEqual(['jackson', 'johnson'])
  })

  it('drops a mismatched state and a bad approval time without throwing', () => {
    const now = new Date('2026-11-14T14:00:00.000Z')
    const approvedAt = new Date('2026-11-14T09:30:00.000Z').toISOString()
    const base = {
      reviewStatus: 'approved' as const,
      approvedAt,
      dnc: false,
      optedOut: false,
      ksLicenseConfirmed: true,
    }
    const rows = preExportFilter([
      { ...base, county: 'jackson', state: 'MO', id: 'jackson' },
      { ...base, county: 'Johnson County', state: 'MO', id: 'johnson-mo' },
      { ...base, county: 'Jackson County', state: 'KS', id: 'jackson-ks' },
      { ...base, county: 'Jackson/Cass', state: 'MO', id: 'compound' },
      { ...base, county: 'Cass County (near Jackson)', state: 'MO', id: 'near' },
      { ...base, county: 'Wyandotte Co.', state: null, id: 'wyandotte' },
      { ...base, county: 'jackson', state: 'MO', approvedAt: 'not-a-time', id: 'bad-time' },
    ], now)
    expect(rows.map((row) => row.id)).toEqual(['jackson', 'wyandotte'])
  })
})
