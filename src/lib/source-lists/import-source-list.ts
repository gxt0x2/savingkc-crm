import {
  buildSourceListImport,
  SOURCE_LIST_STATUSES,
  SourceListImportError,
  type SourceListImportRequest,
  type SourceListRpcPayload,
  type SourceListStatus,
} from '@/lib/source-lists/csv'

export interface SourceListRpcResult {
  data: unknown
  error: { message?: string; details?: string; code?: string } | null
}

export interface SourceListRpcClient {
  rpc(name: string, args: SourceListRpcPayload | Record<string, unknown>): PromiseLike<SourceListRpcResult>
}

export interface SourceListImportResult {
  sourceListId: string
  inserted: number
  updated: number
  rowCount: number
}

const CLIENT_ERRORS = new Set([
  'source_list_rows_required',
  'source_list_too_many_rows',
  'source_list_row_key_required',
  'source_list_lane_invalid',
  'source_list_amount_invalid',
  'source_list_phones_invalid',
  'source_list_raw_invalid',
  'source_list_identity_invalid',
  'source_list_match_key_invalid',
  'source_list_status_invalid',
  'source_list_row_not_found',
  'source_list_lane_mismatch',
  'source_list_identity_immutable',
  'source_list_export_batch_required',
  'source_list_export_batch_not_found',
  'source_list_export_batch_mismatch',
  'source_list_export_too_large',
])

const RPC_ERROR_RESPONSE: Record<string, { status: number; message: string }> = {
  source_list_row_not_found: { status: 404, message: 'That source list row was not found.' },
  source_list_export_batch_required: { status: 400, message: 'Marking a row loaded to the dialer requires the export batch from the scrubbed file.' },
  source_list_export_batch_not_found: { status: 404, message: 'That export batch was not found.' },
  source_list_export_batch_mismatch: { status: 400, message: 'That export batch does not include this row.' },
  source_list_export_too_large: { status: 409, message: 'This export is larger than 10000 phones. Filter by list type, county, or source list and run it again.' },
}

export function sourceListRpcError(error: SourceListRpcResult['error']): SourceListImportError {
  const message = `${error?.message || ''} ${error?.details || ''}`
  const code = [...CLIENT_ERRORS].find((item) => message.includes(item))
  const known = code ? RPC_ERROR_RESPONSE[code] : undefined
  if (known) return new SourceListImportError(known.message, known.status, code!)
  if (code) return new SourceListImportError('The source list could not be saved.', 400, code)
  return new SourceListImportError('The source list could not be saved.', 503, 'source_list_unavailable')
}

function importResult(data: unknown): SourceListImportResult {
  if (!data || typeof data !== 'object') {
    throw new SourceListImportError('The source list could not be saved.', 503, 'source_list_unavailable')
  }
  const row = data as Record<string, unknown>
  const sourceListId = typeof row.source_list_id === 'string' ? row.source_list_id : ''
  const inserted = typeof row.inserted === 'number' ? row.inserted : null
  const updated = typeof row.updated === 'number' ? row.updated : null
  const rowCount = typeof row.row_count === 'number' ? row.row_count : null
  if (!sourceListId || inserted === null || updated === null || rowCount === null) {
    throw new SourceListImportError('The source list could not be saved.', 503, 'source_list_unavailable')
  }
  return { sourceListId, inserted, updated, rowCount }
}

export async function importSourceList(
  db: SourceListRpcClient,
  actor: string,
  request: SourceListImportRequest,
): Promise<SourceListImportResult> {
  const payload = buildSourceListImport(actor, request)
  const { data, error } = await db.rpc('import_source_list_v1', payload)
  if (error) throw sourceListRpcError(error)
  return importResult(data)
}

const SOURCE_LIST_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export async function setSourceListRowStatus(
  db: SourceListRpcClient,
  actor: string,
  rowId: string,
  status: string,
  statusReason: string | null,
  exportBatchId: string | null = null,
): Promise<{ id: string; status: SourceListStatus; statusReason: string | null; loadedAt: string | null; loadedExportBatchId: string | null }> {
  if (!SOURCE_LIST_UUID.test(rowId)) {
    throw new SourceListImportError('That source list row was not found.', 404, 'source_list_row_not_found')
  }
  if (!SOURCE_LIST_STATUSES.includes(status as SourceListStatus)) {
    throw new SourceListImportError('That status is not recognized.', 400, 'source_list_status_invalid')
  }
  const reason = statusReason?.trim() ? statusReason.trim() : null
  if (reason && reason.length > 500) {
    throw new SourceListImportError('Status reason is too long.', 400, 'source_list_status_invalid')
  }
  const batchId = exportBatchId?.trim() ? exportBatchId.trim() : null
  if (status === 'loaded_to_dialer' && !batchId) {
    throw new SourceListImportError(
      'Marking a row loaded to the dialer requires the export batch from the scrubbed file.',
      400,
      'source_list_export_batch_required',
    )
  }
  if (batchId && !SOURCE_LIST_UUID.test(batchId)) {
    throw new SourceListImportError('That export batch was not found.', 404, 'source_list_export_batch_not_found')
  }
  if (status !== 'loaded_to_dialer' && batchId) {
    throw new SourceListImportError('That export batch does not include this row.', 400, 'source_list_export_batch_mismatch')
  }
  const { data, error } = await db.rpc('set_source_list_row_status_v1', {
    p_row_id: rowId,
    p_status: status,
    p_status_reason: reason,
    p_actor: actor.trim(),
    p_export_batch_id: batchId,
  })
  if (error) throw sourceListRpcError(error)
  if (!data || typeof data !== 'object') {
    throw new SourceListImportError('The source list row could not be updated.', 503, 'source_list_unavailable')
  }
  const row = data as Record<string, unknown>
  const id = typeof row.id === 'string' ? row.id : ''
  const next = typeof row.status === 'string' ? row.status : ''
  if (!id || !SOURCE_LIST_STATUSES.includes(next as SourceListStatus)) {
    throw new SourceListImportError('The source list row could not be updated.', 503, 'source_list_unavailable')
  }
  return {
    id,
    status: next as SourceListStatus,
    statusReason: typeof row.status_reason === 'string' ? row.status_reason : null,
    loadedAt: typeof row.loaded_at === 'string' ? row.loaded_at : null,
    loadedExportBatchId: typeof row.loaded_export_batch_id === 'string' ? row.loaded_export_batch_id : null,
  }
}
