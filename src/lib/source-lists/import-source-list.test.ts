import { describe, expect, it, vi } from 'vitest'
import { importSourceList, setSourceListRowStatus, sourceListRpcError } from './import-source-list'
import { recordDialerExportBatch } from './dialer-export'
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
    expect(sourceListRpcError({ message: 'source_list_export_too_large' }).status).toBe(409)
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

  it('requires the scrub batch when a row is marked loaded to the dialer', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        id: '11111111-1111-4111-8111-111111111111',
        status: 'loaded_to_dialer',
        status_reason: null,
        loaded_at: '2026-11-14T12:00:00.000Z',
        loaded_export_batch_id: '22222222-2222-4222-8222-222222222222',
      },
      error: null,
    })
    const batchId = '22222222-2222-4222-8222-222222222222'
    await expect(setSourceListRowStatus(
      { rpc },
      'casey@savingkc.com',
      '11111111-1111-4111-8111-111111111111',
      'loaded_to_dialer',
      null,
    )).rejects.toMatchObject({ code: 'source_list_export_batch_required' })
    await expect(setSourceListRowStatus(
      { rpc },
      'casey@savingkc.com',
      '11111111-1111-4111-8111-111111111111',
      'loaded_to_dialer',
      null,
      batchId,
    )).resolves.toMatchObject({ loadedAt: '2026-11-14T12:00:00.000Z', loadedExportBatchId: batchId })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_export_batch_id: batchId, p_status: 'loaded_to_dialer' })
  })

  it('stamps the export batch id onto every returned phone', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: {
        export_batch_id: '22222222-2222-4222-8222-222222222222',
        phone_count: 1,
        rows: [{
          list_type: 'tax_delinquent',
          county: 'jackson',
          state: 'MO',
          violation_kind: null,
          parcel_id: 'P1',
          case_id: null,
          address: '10 Oak',
          owner_names: 'Ada',
          amount_owed: '5',
          phone_e164: '+18165550101',
          property_id: null,
          prospect_id: null,
          row_status: 'ready',
          pull_date: '2026-11-14',
          source_file_name: 'jackson.csv',
          source_list_row_id: '11111111-1111-4111-8111-111111111111',
          source_list_id: '33333333-3333-4333-8333-333333333333',
          phone_origin: 'source_row',
        }],
      },
      error: null,
    })
    const result = await recordDialerExportBatch({ rpc }, 'casey@savingkc.com', {
      listType: 'tax_delinquent',
      county: 'jackson',
      state: 'MO',
      violationKind: null,
      sourceListId: null,
    })
    expect(rpc.mock.calls[0][0]).toBe('record_source_list_export_batch_v1')
    expect(result.rows[0].export_batch_id).toBe('22222222-2222-4222-8222-222222222222')
    expect(result.rows[0].phone_e164).toBe('+18165550101')
  })
})
