import { describe, expect, it, vi } from 'vitest'
import { importSourceList } from './import-source-list'

vi.mock('@/lib/email-validation/record', () => ({
  recordWrittenEmails: vi.fn(async () => {}),
}))

import { recordWrittenEmails } from '@/lib/email-validation/record'

describe('source list import validates emails before saving rows', () => {
  it('passes owner emails from the CSV to the ledger', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { source_list_id: 'list-1', inserted: 1, updated: 0, row_count: 1 },
      error: null,
    })
    await importSourceList({ rpc }, 'casey@savingkc.com', {
      listType: 'tax_delinquent',
      county: 'platte',
      state: 'MO',
      pullDate: '2026-11-14',
      fileName: 'platte.csv',
      csvText: 'parcel_id,owner,email\nP1,Ada,Ada@Example.com\n',
    })
    expect(recordWrittenEmails).toHaveBeenCalledWith(['Ada@Example.com'])
    expect(rpc).toHaveBeenCalledOnce()
  })
})
