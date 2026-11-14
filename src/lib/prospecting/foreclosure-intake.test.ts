import { describe, expect, it } from 'vitest'
import {
  FORECLOSURE_INTAKE_SOURCES,
  KS_LICENSE_BLOCK,
  appendIntakeNotice,
  automaticLoadAllowed,
  bestIntakeMatch,
  equityEnrichmentHook,
  extractZip,
  foreclosureIntakeOutreachBlockers,
  intakeRowsReachableForDialerOrExport,
  intakeSourceAcceptsRows,
  matchIntakeSourceDefinition,
  normalizePartyName,
  normalizeStreetAddress,
  openingTimeline,
  prepareIntakeRow,
  presentIngestControls,
  type IntakeMatchCandidate,
  type PreparedIntake,
} from '@/lib/prospecting/foreclosure-intake'

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

  it('matches normalized owner, trustee, and sale date when address is unknown', () => {
    const incoming = prepared({
      parcel_id: '',
      property_address: 'No street listed',
      owner_or_defendant: 'Homeowner, Sample',
      plaintiff_or_trustee_firm: 'Sample Trustee, LLC',
      sale_date: '2026-12-01',
    })
    expect(normalizePartyName('Homeowner, Sample')).toBe('sample homeowner')
    const match = bestIntakeMatch(incoming, [
      candidate({
        id: 'party',
        ownerKey: 'sample homeowner',
        trusteeKey: 'sample trustee llc',
        saleDate: '2026-12-01',
      }),
    ])
    expect(match).toMatchObject({ tier: 'owner_trustee_sale', candidate: { id: 'party' } })
  })

  it('uses the case or notice number as a second key', () => {
    const incoming = prepared({ parcel_id: '', property_address: '', sale_date: '2026-12-15' })
    const match = bestIntakeMatch(incoming, [
      candidate({ id: 'case', noticeKey: incoming.noticeKey, saleDate: '2026-12-01' }),
    ])
    expect(match).toMatchObject({ tier: 'case_or_notice', candidate: { id: 'case' } })
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

  it('still applies do-not-call, opt-out, and the Kansas license flag', () => {
    expect(foreclosureIntakeOutreachBlockers({ ...pending, reviewStatus: 'approved', dnc: true })).toContain('do_not_call')
    expect(foreclosureIntakeOutreachBlockers({ ...pending, reviewStatus: 'approved', optedOut: true })).toContain('sms_opt_out')
    expect(foreclosureIntakeOutreachBlockers({
      reviewStatus: 'approved',
      state: 'KS',
      county: 'johnson',
      dnc: false,
      optedOut: false,
      ksLicenseConfirmed: false,
    })).toContain(KS_LICENSE_BLOCK)
    expect(foreclosureIntakeOutreachBlockers({
      reviewStatus: 'approved',
      state: 'KS',
      county: 'johnson',
      dnc: false,
      optedOut: false,
      ksLicenseConfirmed: null,
    })).toContain(KS_LICENSE_BLOCK)
    expect(intakeRowsReachableForDialerOrExport([{
      reviewStatus: 'rejected',
      state: 'MO',
      county: 'clay',
      dnc: false,
      optedOut: false,
      ksLicenseConfirmed: true,
    }])).toEqual([])
  })
})
