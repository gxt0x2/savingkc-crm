import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  classifyOwnerEntity,
  deriveForeclosureStatus,
  dialReadyBlockers,
  equityBand,
  foreclosureCallingHref,
  normalizeForeclosureInput,
  parseForeclosureCsv,
} from './foreclosure'

const sandboxCsv = readFileSync(join(process.cwd(), 'docs/prospecting/mortgage-foreclosure-sandbox.csv'), 'utf8')

describe('mortgage foreclosure equity and skip-trace locks', () => {
  it('computes equity bands with a $75k floor and $100k sort priority', () => {
    expect(equityBand(150_000)).toBe('strong_100k+')
    expect(equityBand(75_000)).toBe('ideal_75k+')
    expect(equityBand(99_999)).toBe('ideal_75k+')
    expect(equityBand(40_000)).toBe('thin_40_74')
    expect(equityBand(39_999)).toBe('kill_lt40')
  })

  it('keeps SmartSkip off entities, other vendors, and rows below the floor', () => {
    expect(classifyOwnerEntity('Ernest Dodson')).toBe('person')
    expect(classifyOwnerEntity('Dodson Family Trust')).toBe('trust')
    expect(classifyOwnerEntity('Sandbox Holdings LLC')).toBe('llc')
    expect(classifyOwnerEntity('Estate of Jane Doe')).toBe('estate')

    const trust = normalizeForeclosureInput({
      county: 'Johnson',
      ownerName: 'Dodson Family Trust',
      situs: '200 Sandbox Court',
      estValue: 300000,
      estDebt: 100000,
      skiptraceVendor: 'SmartSkip',
      phone1: '9135550100',
    })
    expect(trust.ok && trust.record.phones).toEqual([])
    expect(trust.ok && trust.record.skiptraceVendor).toBeNull()
    expect(trust.ok && trust.record.status).toBe('equity_screened')
    expect(trust.ok && trust.warnings.join(' ')).toMatch(/not a person/)

    const otherVendor = normalizeForeclosureInput({
      county: 'jackson',
      ownerName: 'Casey Person',
      situs: '300 Sandbox Court',
      estValue: 300000,
      estDebt: 100000,
      skiptraceVendor: 'DataSkip',
      phone1: '9135550101',
    })
    expect(otherVendor.ok && otherVendor.record.phones).toEqual([])
    expect(otherVendor.ok && otherVendor.record.skiptraceVendor).toBeNull()

    const thin = normalizeForeclosureInput({
      county: 'jackson',
      ownerName: 'Casey Person',
      situs: '300 Sandbox Court',
      estValue: 120000,
      estDebt: 80000,
      skiptraceVendor: 'smartskip',
      phone1: '9135550101',
    })
    expect(thin.ok && thin.record.estEquity).toBe(40_000)
    expect(thin.ok && thin.record.phones).toEqual([])
    expect(thin.ok && thin.record.status).toBe('equity_screened')
  })

  it('rejects tax rows and makes a person with $75k+ SmartSkip phones callable', () => {
    const tax = normalizeForeclosureInput({
      county: 'jackson',
      ownerName: 'Casey Person',
      situs: '1 Tax Road',
      tax_or_dlt_flag: 'true',
      doc_type: 'Tax Sale',
    })
    expect(tax.ok).toBe(false)

    const ready = normalizeForeclosureInput({
      county: 'Jackson County',
      state: 'MO',
      ownerName: 'Casey Person',
      situs: '400 Sandbox Court',
      est_value: '200000',
      est_debt: '125000',
      skiptrace_vendor: 'SmartSkip',
      phone_1: '(913) 555-0102',
      deceased_flag: 'no',
      lifecycle_status: 'scheduled sale',
    })
    expect(ready.ok && ready.record).toMatchObject({
      county: 'jackson',
      state: 'MO',
      estEquity: 75_000,
      equityBand: 'ideal_75k+',
      status: 'callable',
      noticeLifecycle: 'scheduled_sale',
      phones: ['+19135550102'],
      deceased: false,
    })
    expect(ready.ok && dialReadyBlockers({
      ownerEntity: ready.record.ownerEntity,
      deceased: ready.record.deceased,
      vendor: ready.record.skiptraceVendor,
      phones: ready.record.phones,
      estEquity: ready.record.estEquity,
      status: ready.record.status,
    })).toEqual([])
  })

  it('keeps a deceased SmartSkip owner out of the dial queue', () => {
    const deceased = normalizeForeclosureInput({
      county: 'johnson',
      ownerName: 'Casey Person',
      situs: '500 Sandbox Court',
      estValue: 250000,
      estDebt: 50000,
      skiptraceVendor: 'smartskip',
      phone1: '9135550103',
      deceased: 'yes',
    })
    expect(deceased.ok && deceased.record.status).toBe('skip_traced')
    expect(deceased.ok && deceased.record.deceased).toBe(true)
    expect(deriveForeclosureStatus('dnc', deceased.ok ? deceased.record : {
      ownerEntity: 'person', deceased: false, skiptraceVendor: 'smartskip', phones: [], estEquity: 1, estValue: 1, estDebt: 0,
    })).toBe('dnc')
  })

  it('imports the approved sandbox CSV as a callable person owner', () => {
    const parsed = parseForeclosureCsv(sandboxCsv)
    expect(parsed.rejected).toEqual([])
    expect(parsed.accepted).toHaveLength(1)
    expect(parsed.accepted[0]).toMatchObject({
      externalRowId: 'sandbox-ernest-001',
      ownerName: 'Ernest Dodson',
      county: 'jackson',
      estEquity: 150_000,
      equityBand: 'strong_100k+',
      status: 'callable',
      phones: ['+19137179716'],
      email: 'savingkc@gmail.com',
      skiptraceVendor: 'smartskip',
    })
    expect(foreclosureCallingHref('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'))
      .toContain('prospect_ids=11111111-1111-4111-8111-111111111111')
  })
})
