import { describe, expect, it } from 'vitest'
import { buildSourceListImport, sourceListMatchKey, SourceListImportError } from './csv'

const actor = 'casey@savingkc.com'

function csv(rows: string): string {
  return rows.trim()
}

describe('source list csv import', () => {
  it('upserts a tax list by parcel and records the file hash', () => {
    const text = csv(`
      Parcel ID,Owner Name,Address,City,State,Amount Owed,Phone
      12-345-67,Ada Owner,10 Oak,Kansas City,MO,"$1,234.50",816-555-0101
      12-345-67,Ada Owner,11 Oak,Kansas City,MO,10,816-555-0199
    `)
    const payload = buildSourceListImport(actor, {
      listType: 'tax',
      county: 'Jackson',
      state: 'Missouri',
      pullDate: '2026-11-14',
      fileName: 'jackson-tax.csv',
      csvText: text,
    })

    expect(payload.p_list_type).toBe('tax_delinquent')
    expect(payload.p_county).toBe('jackson')
    expect(payload.p_state).toBe('MO')
    expect(payload.p_rows).toHaveLength(1)
    expect(payload.p_rows[0]).toMatchObject({
      parcel_id: '12-345-67',
      case_id: null,
      address: '11 Oak, Kansas City, MO',
      owner_names: 'Ada Owner',
      amount_owed: '10',
      phones: ['816-555-0199'],
    })
    expect(payload.p_source_file_name).toBe('jackson-tax.csv')
    expect(payload.p_source_file_sha256).toMatch(/^[a-f0-9]{64}$/)
    expect(payload.p_source_file_bytes).toBe(Buffer.byteLength(text))
    expect(sourceListMatchKey('tax_delinquent', '12-345-67', null)).toBe('parcel:12-345-67')
  })

  it('keeps foreclosure rows apart by case id and rejects a spreadsheet', () => {
    const payload = buildSourceListImport(actor, {
      listType: 'foreclosure',
      county: 'johnson',
      state: 'KS',
      pullDate: '2026-11-01',
      fileName: 'ks-foreclosure.csv',
      sourceUrl: 'https://example.com/sales',
      csvText: csv(`
        case_number,parcel_id,owner,phone_1,phone_2
        24CV1,PARCEL-A,Pat Seller,8165550101,9135550102
        24CV2,PARCEL-A,Pat Seller,8165550101,
      `),
    })
    expect(payload.p_rows.map((row) => row.case_id)).toEqual(['24CV1', '24CV2'])
    expect(payload.p_rows[0].phones).toEqual(['8165550101', '9135550102'])
    expect(payload.p_source_url).toBe('https://example.com/sales')

    expect(() => buildSourceListImport(actor, {
      listType: 'foreclosure',
      state: 'KS',
      pullDate: '2026-11-01',
      fileName: 'sales.xlsx',
      csvText: 'case_number\n1',
    })).toThrow(SourceListImportError)
  })

  it('requires a case.net lane to stay in Missouri and a code violation to name its kind', () => {
    expect(() => buildSourceListImport(actor, {
      listType: 'case.net',
      state: 'KS',
      pullDate: '2026-11-14',
      fileName: 'estates.csv',
      csvText: 'case_number\n24PR1',
    })).toThrow(/Missouri/)

    const payload = buildSourceListImport(actor, {
      listType: 'code violation',
      violationKind: 'board-up',
      state: 'MO',
      pullDate: '2026-11-14',
      fileName: 'board-up.csv',
      csvText: 'parcel\nKC1',
    })
    expect(payload.p_list_type).toBe('code_violation')
    expect(payload.p_violation_kind).toBe('board_up')
    expect(payload.p_county).toBeNull()
    expect(payload.p_rows[0].parcel_id).toBe('KC1')
  })

  it('rejects a row that has neither a parcel nor a case', () => {
    expect(() => buildSourceListImport(actor, {
      listType: 'probate_no_property',
      state: 'MO',
      pullDate: '2026-11-14',
      fileName: 'follow-up.csv',
      csvText: 'owner\nNo Case',
    })).toThrow(/parcel id or a case id/)
  })
})
