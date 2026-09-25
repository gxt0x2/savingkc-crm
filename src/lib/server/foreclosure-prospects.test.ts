import { beforeEach, describe, expect, it, vi } from 'vitest'

const inserts: Array<{ table: string; payload: unknown }> = []
const mocks = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock('@/lib/supabase-lazy', () => ({ supabase: { from: mocks.from } }))

import { prepareForeclosureCall } from './foreclosure-prospects'

const recordId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const prospectId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const phoneId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'

function queryResult(data: unknown) {
  const promise = Promise.resolve({ data, error: null })
  const builder = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return promise.then.bind(promise)
      if (prop === 'insert') {
        return (payload: unknown) => {
          inserts.push({ table: 'pending', payload })
          return builder
        }
      }
      return () => builder
    },
  })
  return builder
}

const readyRow = {
  id: recordId,
  external_row_id: 'sandbox-ernest-001',
  county: 'jackson',
  state: 'MO',
  status: 'callable',
  notice_lifecycle: 'scheduled_sale',
  source_name: null,
  source_url: null,
  source_layer: null,
  pull_date: null,
  notice_or_filing_date: null,
  sale_date: null,
  sale_time: null,
  sale_location: null,
  case_number: null,
  instrument_number: null,
  book_page: null,
  doc_type: null,
  owner_name: 'Ernest Dodson',
  owner_entity: 'person',
  plaintiff_lender: null,
  trustee_or_firm: null,
  situs: '100 Sandbox Court',
  city: 'Kansas City',
  zip: '64108',
  legal_description: null,
  parcel_id: 'SANDBOX-PARCEL-001',
  opening_bid: null,
  min_bid: null,
  amount_claimed: null,
  notes: null,
  recorder_confirmed: false,
  court_confirmed: false,
  est_value: 240000,
  est_value_source: 'manual',
  est_debt: 90000,
  est_debt_source: 'notice',
  est_equity: 150000,
  equity_band: 'strong_100k+',
  preferable: true,
  skiptrace_vendor: 'smartskip',
  skiptrace_date: null,
  skiptrace_batch_id: null,
  phone_1: '+19137179716',
  phone_2: null,
  phone_3: null,
  email_1: 'savingkc@gmail.com',
  deceased_flag: false,
  skiptrace_notes: null,
  prospect_id: null,
  lead_id: null,
  updated_at: '2026-09-25T00:00:00.000Z',
}

describe('foreclosure call preparation', () => {
  beforeEach(() => {
    inserts.length = 0
    vi.clearAllMocks()
  })

  it('creates a tracked dialing prospect and reuses the prospecting calling floor', async () => {
    const tables: string[] = []
    mocks.from.mockImplementation((table: string) => {
      tables.push(table)
      const visit = tables.filter((item) => item === table).length
      if (table === 'mortgage_foreclosure_prospects' && visit === 1) return queryResult(readyRow)
      if (table === 'sms_opt_outs') return queryResult([])
      if (table === 'prospects') return queryResult({ id: prospectId })
      if (table === 'prospect_phones' && visit === 1) return queryResult([])
      if (table === 'prospect_phones') return queryResult({ id: phoneId })
      return queryResult(null)
    })
    const result = await prepareForeclosureCall({ email: 'savingkc@gmail.com', name: 'Ernest Dodson' }, recordId)
    expect(result).toMatchObject({
      prospectId,
      prospectPhoneId: phoneId,
      phone: '+19137179716',
    })
    expect(result.href).toContain(`/prospecting?prospect_ids=${prospectId}`)
    expect(result.href).toContain('queue_label=Mortgage+Foreclosure')
    expect(result.href).toContain(encodeURIComponent(`/prospecting/foreclosure/${recordId}`))
    const prospectInsert = inserts.find((item) => item.payload && typeof item.payload === 'object' && 'prospect_track' in (item.payload as object))
    expect(prospectInsert?.payload).toMatchObject({
      prospect_track: 'mortgage_foreclosure',
      parcel_id: `mfc:${recordId}`,
      delinquent_years_category: null,
      county: 'jackson',
    })
  })

  it('fails closed on an opted-out number and does not create a dialing prospect', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'mortgage_foreclosure_prospects') return queryResult(readyRow)
      if (table === 'sms_opt_outs') return queryResult([{ phone: '+19137179716' }])
      throw new Error(`unexpected ${table}`)
    })
    await expect(prepareForeclosureCall({ email: 'savingkc@gmail.com', name: 'Ernest' }, recordId)).rejects.toMatchObject({
      code: 'dnc',
      status: 409,
    })
    expect(inserts).toEqual([])
  })

  it('refuses a below-floor row before any dialing write', async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === 'mortgage_foreclosure_prospects') return queryResult({ ...readyRow, est_equity: 10000, status: 'equity_screened', phone_1: null, skiptrace_vendor: null })
      throw new Error(`unexpected ${table}`)
    })
    await expect(prepareForeclosureCall({ email: 'savingkc@gmail.com', name: 'Ernest' }, recordId)).rejects.toMatchObject({
      code: 'not_dial_ready',
    })
  })
})
