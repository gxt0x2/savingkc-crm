import { describe, expect, it } from 'vitest'
import { summarizeClayInstallments } from './balances'
import {
  judgeLiveBalance,
  nextTaxTier,
  serviceCounty,
  taxExportAllowed,
} from './decision'
import { planTaxGateCandidate, selectTaxGateCandidates, type TaxGateCandidate } from './gate'
import { MOJO_CONTACT_WRITE_API, mojoRemovalCsv, removalWorkItems } from './mojo-removal'
import { runTaxStatusPlans } from './run'
import { taxStatusWindow } from './schedule'

const NOW = new Date('2026-11-15T09:00:00.000Z')

function candidate(overrides: Partial<TaxGateCandidate> = {}): TaxGateCandidate {
  return {
    key: 'source:1',
    parcelId: '12345678901234',
    county: 'clay',
    listType: 'tax_delinquent',
    prospectTrack: 'tax',
    tier: '3yr_plus',
    historicalTag: '3yr_plus',
    createdAt: '2026-11-15T08:00:00.000Z',
    scoredAt: null,
    onDialerList: true,
    rowStatus: 'loaded_to_dialer',
    propertyId: 'property-1',
    prospectId: 'prospect-1',
    sourceListRowId: 'row-1',
    foreclosureId: null,
    contacts: [{ name: 'Ada Owner', phone: '+18165550100', mojoListName: 'Jackson · Tax 3+ · Aug 30' }],
    ...overrides,
  }
}

describe('live delinquency', () => {
  it('ignores a historical Tax 3+ tag when the county balance is paid or under $500', () => {
    expect(judgeLiveBalance({
      balance: { balance: 0, yearsOwed: 4, redeemed: false },
      sourceDown: false,
      historicalTag: '3yr_plus',
    })).toBe('not_delinquent')
    expect(judgeLiveBalance({
      balance: { balance: 499.99, yearsOwed: 3, redeemed: false },
      sourceDown: false,
      historicalTag: 'Tax 3+',
    })).toBe('not_delinquent')
    expect(judgeLiveBalance({
      balance: { balance: 8000, yearsOwed: 3, redeemed: true },
      sourceDown: false,
      historicalTag: '3yr_plus',
    })).toBe('not_delinquent')
  })

  it('requires a prior year and at least $500 on the latest balance', () => {
    expect(judgeLiveBalance({
      balance: { balance: 500, yearsOwed: 1, redeemed: false },
      sourceDown: false,
      historicalTag: null,
    })).toBe('delinquent')
    expect(judgeLiveBalance({
      balance: { balance: 900, yearsOwed: 0, redeemed: false },
      sourceDown: false,
      historicalTag: '3yr_plus',
    })).toBe('not_delinquent')
  })

  it('stays not_verified when the county source is down, even with a Tax 3+ tag', () => {
    expect(judgeLiveBalance({
      balance: null,
      sourceDown: true,
      historicalTag: '3yr_plus',
    })).toBe('not_verified')
  })

  it('parses Clay string balances as numbers', () => {
    const summary = summarizeClayInstallments([
      { year: 2025, ok: true, balance: '1,234.56' },
      { year: 2024, ok: true, balance: '1234.56' },
    ], new Date('2026-11-15T09:00:00.000Z'))
    expect(summary.balance).toBeCloseTo(2469.12)
    expect(summary.yearsOwed).toBe(2)
    expect(judgeLiveBalance({ balance: summary, sourceDown: false })).toBe('delinquent')
  })

  it('moves a 3+ parcel down to 2 years instead of dropping it while it is still delinquent', () => {
    expect(nextTaxTier('3yr_plus', 2, true)).toBe('2yr')
    expect(nextTaxTier('3yr_plus', 1, true)).toBe('2yr')
    expect(nextTaxTier('2yr', 1, true)).toBe('2yr')
    expect(nextTaxTier('3yr_plus', 0, false)).toBeNull()
  })

  it('does not treat Cass or any other county as a service area', () => {
    expect(serviceCounty('Cass County')).toBeNull()
    expect(serviceCounty('Jackson')).toBe('jackson')
    expect(serviceCounty('Wyandotte')).toBe('wyandotte')
  })
})

describe('schedule', () => {
  it('runs the weekly recheck at 3:00am Chicago on Sunday and the nightly batch on other days', () => {
    expect(taxStatusWindow(new Date('2026-11-15T09:00:00.000Z'))).toMatchObject({
      phase: 'weekly',
      allowAdd: true,
      callSources: true,
    })
    expect(taxStatusWindow(new Date('2026-07-15T08:00:00.000Z'))).toMatchObject({
      phase: 'nightly',
      allowAdd: true,
    })
    expect(taxStatusWindow(new Date('2026-11-15T08:00:00.000Z')).phase).toBe('idle')
  })

  it('scrubs at 7:55am Chicago and only suppresses after 4:00am', () => {
    expect(taxStatusWindow(new Date('2026-11-16T13:55:00.000Z'))).toMatchObject({
      phase: 'pre_export',
      allowAdd: false,
      callSources: false,
    })
    expect(taxStatusWindow(new Date('2026-07-15T12:55:00.000Z')).phase).toBe('pre_export')
    expect(taxStatusWindow(new Date('2026-07-15T09:00:00.000Z'))).toMatchObject({
      phase: 'suppress_only',
      allowAdd: false,
      callSources: false,
    })
  })
})

describe('list behavior', () => {
  it('suppresses a paid-up tax row and queues the Mojo contact for browser removal', async () => {
    const plan = await planTaxGateCandidate(candidate(), {
      now: NOW,
      allowAdd: true,
      callSources: true,
      stored: null,
      lookup: async () => ({ ok: true, source: 'clay_collector', balance: { balance: 0, yearsOwed: 0, redeemed: false } }),
    })
    expect(plan.result).toBe('not_delinquent')
    expect(plan.nextStatus).toBe('dropped')
    expect(plan.queueRemoval).toBe(true)
    expect(plan.exportAllowed).toBe(false)
    const csv = mojoRemovalCsv(removalWorkItems([plan]))
    expect(csv).toContain('contact_name,phone,mojo_list_name')
    expect(csv).toContain('Ada Owner,+18165550100,Jackson · Tax 3+ · Aug 30')
    expect(MOJO_CONTACT_WRITE_API).toBeNull()
  })

  it('holds a tax row when the county source is down and does not promote it', async () => {
    const plan = await planTaxGateCandidate(candidate({ rowStatus: 'new', onDialerList: false }), {
      now: NOW,
      allowAdd: true,
      callSources: true,
      stored: null,
      lookup: async () => ({ ok: false, source: 'clay_collector', reason: 'source_down' }),
    })
    expect(plan.result).toBe('not_verified')
    expect(plan.nextStatus).toBeNull()
    expect(plan.exportAllowed).toBe(false)
    expect(plan.queueRemoval).toBe(false)
  })

  it('does not add rows after 4:00am even when the live balance is still delinquent', async () => {
    const plan = await planTaxGateCandidate(candidate({ rowStatus: 'new', onDialerList: false, contacts: [] }), {
      now: new Date('2026-11-15T15:00:00.000Z'),
      allowAdd: false,
      callSources: false,
      stored: {
        result: 'delinquent',
        checkedAt: '2026-11-15T09:10:00.000Z',
        source: 'clay_collector',
        balance: 1200,
        yearsOwed: 2,
      },
      lookup: async () => { throw new Error('county should not be called') },
    })
    expect(plan.nextStatus).toBeNull()
    expect(plan.exportAllowed).toBe(true)
    expect(plan.tierAfter).toBe('2yr')
  })

  it('records tax status and raises rank on a foreclosure row without suppressing a paid parcel', async () => {
    const paid = await planTaxGateCandidate(candidate({
      listType: 'foreclosure',
      prospectTrack: 'mortgage_foreclosure',
      foreclosureId: 'fc-1',
      sourceListRowId: 'row-fc',
      tier: null,
      historicalTag: null,
      contacts: [],
    }), {
      now: NOW,
      allowAdd: true,
      callSources: true,
      stored: null,
      lookup: async () => ({ ok: true, source: 'jackson_tax_portal', balance: { balance: 0, yearsOwed: 0, redeemed: true } }),
    })
    expect(paid.nextStatus).toBeNull()
    expect(paid.rankBoost).toBe(0)
    expect(paid.queueRemoval).toBe(false)

    const owed = await planTaxGateCandidate(candidate({
      listType: 'foreclosure',
      prospectTrack: 'mortgage_foreclosure',
      county: 'jackson',
    }), {
      now: NOW,
      allowAdd: true,
      callSources: true,
      stored: null,
      lookup: async () => ({ ok: true, source: 'jackson_tax_portal', balance: { balance: 2500, yearsOwed: 2, redeemed: false } }),
    })
    expect(owed.rankBoost).toBe(1)
    expect(owed.nextStatus).toBeNull()
  })

  it('does not check Cass and blocks a tax export with no fresh live check', async () => {
    const skipped = await planTaxGateCandidate(candidate({ county: 'cass', historicalTag: '3yr_plus' }), {
      now: NOW,
      allowAdd: true,
      callSources: true,
      stored: null,
      lookup: async () => { throw new Error('cass must not be called') },
    })
    expect(skipped.result).toBe('skipped_out_of_area')
    expect(skipped.exportAllowed).toBe(false)

    expect(taxExportAllowed({
      result: 'delinquent',
      checkedAt: '2026-11-01T09:00:00.000Z',
      source: 'clay_collector',
    }, NOW)).toBe(false)
    expect(taxExportAllowed({
      result: 'delinquent',
      checkedAt: '2026-11-14T09:00:00.000Z',
      source: 'historical_tag',
    }, NOW)).toBe(false)
  })

  it('checks new rows nightly and older dialer rows on the Sunday recheck', async () => {
    const fresh = candidate({ key: 'new', onDialerList: false, rowStatus: 'new' })
    const oldDialer = candidate({
      key: 'old',
      createdAt: '2026-08-01T12:00:00.000Z',
      scoredAt: '2026-08-01T12:00:00.000Z',
      onDialerList: true,
    })
    const oldQuiet = candidate({
      key: 'quiet',
      createdAt: '2026-08-01T12:00:00.000Z',
      scoredAt: null,
      onDialerList: false,
      rowStatus: 'ready',
    })
    expect(selectTaxGateCandidates([fresh, oldDialer, oldQuiet], 'nightly', NOW, '2026-11-15').map((row) => row.key)).toEqual(['new'])
    expect(selectTaxGateCandidates([fresh, oldDialer, oldQuiet], 'weekly', NOW, '2026-11-15').map((row) => row.key).sort()).toEqual(['new', 'old', 'quiet'])
  })
})

describe('run', () => {
  it('does not call the county outside the 3:00am window', async () => {
    const run = await runTaxStatusPlans({
      now: new Date('2026-11-15T08:30:00.000Z'),
      candidates: [candidate()],
      storedByKey: new Map(),
      lookup: async () => { throw new Error('should not look up') },
    })
    expect(run.window.phase).toBe('idle')
    expect(run.plans).toEqual([])
  })
})
