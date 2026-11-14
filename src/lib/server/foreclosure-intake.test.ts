import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; payload: unknown }> = []
const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { attemptForeclosureIntakeDialerOrExport } from './foreclosure-intake'

const intakeId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function queryResult(data: unknown) {
  const promise = Promise.resolve({ data, error: null })
  const builder = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return promise.then.bind(promise)
      if (prop === 'insert') {
        return (payload: unknown) => {
          inserts.push({ table: 'write', payload })
          return builder
        }
      }
      return () => builder
    },
  })
  return builder
}

describe('foreclosure intake dialer and export gate', () => {
  beforeEach(() => {
    inserts.length = 0
    vi.clearAllMocks()
    vi.stubEnv('KS_FORECLOSURE_LICENSE_CONFIRMED', '')
  })

  it('stops a pending row before any dialer or export write', async () => {
    const tables: string[] = []
    mocks.from.mockImplementation((table: string) => {
      tables.push(table)
      if (table === 'mortgage_foreclosure_prospects' || table === 'prospects' || table === 'prospect_phones') {
        throw new Error(`pending row reached ${table}`)
      }
      if (table === 'mortgage_foreclosure_intake') {
        return queryResult({
          id: intakeId,
          review_status: 'pending',
          state: 'KS',
          county: 'johnson',
          source_name: 'KS e-filing',
          owner_name: 'Sample Defendant',
          property_address: '200 Sample Lane',
        })
      }
      if (table === 'sms_opt_outs') return queryResult([])
      return queryResult(null)
    })

    const decision = await attemptForeclosureIntakeDialerOrExport(intakeId)
    expect(decision.allowed).toBe(false)
    expect(decision.blockers).toEqual(expect.arrayContaining(['intake_not_approved', 'ks_license_unconfirmed']))
    expect(inserts).toEqual([])
    expect(tables).not.toContain('mortgage_foreclosure_prospects')
    expect(tables).not.toContain('prospects')
    expect(tables).not.toContain('prospect_phones')
  })
})
