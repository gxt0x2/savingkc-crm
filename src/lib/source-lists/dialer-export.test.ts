import { describe, expect, it, vi } from 'vitest'
import { dialerExportCsv, readDialerExport, recordDialerExportBatch, type DialerExportRow } from './dialer-export'
import { SourceListImportError } from './csv'

function row(phone: string, address = '10 Oak'): DialerExportRow {
  return {
    list_type: 'tax_delinquent',
    county: 'jackson',
    state: 'MO',
    violation_kind: null,
    parcel_id: 'P1',
    case_id: null,
    address,
    owner_names: 'Ada Owner',
    amount_owed: '10.00',
    phone_e164: phone,
    property_id: null,
    prospect_id: null,
    row_status: 'ready',
    pull_date: '2026-11-14',
    source_file_name: 'jackson.csv',
    source_list_row_id: 'row-1',
    source_list_id: 'list-1',
    phone_origin: 'source_row',
    export_batch_id: 'batch-1',
    requires_licensee_disclosure: false,
    ks_license_unconfirmed: false,
    basis: 'tax_delinquent',
    calling_window: null,
  }
}

describe('dialer export file', () => {
  it('writes a header even when every number was scrubbed', () => {
    expect(dialerExportCsv([])).toBe(
      'list_type,county,state,violation_kind,parcel_id,case_id,address,owner_names,amount_owed,phone_e164,property_id,prospect_id,row_status,pull_date,source_file_name,source_list_row_id,source_list_id,phone_origin,export_batch_id,requires_licensee_disclosure,ks_license_unconfirmed,basis,calling_window\n',
    )
  })

  it('keeps a dialable phone and quotes a spreadsheet formula in the address', () => {
    const csv = dialerExportCsv([row('+18165550101', '=cmd')])
    expect(csv).toContain('+18165550101')
    expect(csv).toContain("'=cmd")
    expect(csv).not.toContain('sms_opt_out')
  })

  it('stops instead of returning a partial file past the cap', async () => {
    const fetchPage = vi.fn().mockResolvedValue({
      data: Array.from({ length: 1000 }, (_, index) => row(`+1816555${String(index).padStart(4, '0')}`)),
      error: null,
    })
    await expect(readDialerExport(fetchPage)).rejects.toMatchObject({ code: 'export_too_large', status: 409 })
    expect(fetchPage).toHaveBeenCalledTimes(10)
  })

  it('returns the pages it received when the last page is short', async () => {
    const fetchPage = vi.fn()
      .mockResolvedValueOnce({ data: [row('+18165550101')], error: null })
    await expect(readDialerExport(fetchPage)).resolves.toHaveLength(1)
  })

  it('keeps excluded phones masked to the last 4', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        export_batch_id: '22222222-2222-4222-8222-222222222222',
        rows: [row('+18165550101')],
        excluded_counts: { prospect_dnc: 1, leaked: '3' },
        excluded_phones: [
          { reason: 'prospect_dnc', phone_masked: '******4411' },
          { reason: 'prospect_dnc', phone_masked: '+18165554411' },
          { reason: 'prospect_dnc', phone_masked: '4411' },
        ],
      },
      error: null,
    })
    const scrub = await recordDialerExportBatch({ rpc }, 'casey@savingkc.com', {
      listType: null,
      county: null,
      state: null,
      violationKind: null,
      sourceListId: null,
    })
    expect(scrub.excludedCounts).toEqual({ prospect_dnc: 1 })
    expect(scrub.excludedPhones).toEqual([{ reason: 'prospect_dnc', phoneMasked: '******4411' }])
  })

  it('does not turn a database error into an empty file', async () => {
    await expect(readDialerExport(async () => ({ data: null, error: { message: 'down' } }))).rejects.toBeInstanceOf(SourceListImportError)
  })
})
