import { describe, expect, it, vi } from 'vitest'
import { importSourceList, setSourceListRowStatus, sourceListRpcError } from './import-source-list'
import { SourceListImportError } from './csv'

describe('source list import client', () => {
  it('sends the parsed file to the idempotent import function', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { source_list_id: 'list-1', inserted: 1, updated: 0, row_count: 1 },
      error: null,
    })
    const result = await importSourceList({ rpc }, 'casey@savingkc.com', {
      listType: 'tax_delinquent',
      county: 'platte',
      state: 'MO',
      pullDate: '2026-11-14',
      fileName: 'platte.csv',
      csvText: 'parcel_id,owner\nP1,Ada\n',
    })
    expect(result).toEqual({ sourceListId: 'list-1', inserted: 1, updated: 0, rowCount: 1 })
    expect(rpc.mock.calls[0][0]).toBe('import_source_list_v1')
    expect(rpc.mock.calls[0][1].p_rows).toEqual([
      expect.objectContaining({ parcel_id: 'P1', owner_names: 'Ada' }),
    ])
  })

  it('maps a database lane error to a client error and hides anything else', () => {
    expect(sourceListRpcError({ message: 'source_list_lane_invalid' }).status).toBe(400)
    expect(sourceListRpcError({ message: 'connection reset' }).status).toBe(503)
  })

  it('updates status without accepting an unknown value', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: { id: '11111111-1111-4111-8111-111111111111', status: 'ready', status_reason: null },
      error: null,
    })
    await expect(setSourceListRowStatus(
      { rpc },
      'casey@savingkc.com',
      '11111111-1111-4111-8111-111111111111',
      'ready',
      null,
    )).resolves.toMatchObject({ status: 'ready' })
    expect(rpc.mock.calls[0][0]).toBe('set_source_list_row_status_v1')
    await expect(setSourceListRowStatus(
      { rpc },
      'casey@savingkc.com',
      '11111111-1111-4111-8111-111111111111',
      'dial_now',
      null,
    )).rejects.toBeInstanceOf(SourceListImportError)
    expect(rpc).toHaveBeenCalledTimes(1)
  })
})
