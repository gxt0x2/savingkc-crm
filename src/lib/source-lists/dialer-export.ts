import { exportLineModeBlock } from '@/lib/dialer-suppression-policy'
import { SourceListImportError } from '@/lib/source-lists/csv'
import { sourceListRpcError, type SourceListRpcClient } from '@/lib/source-lists/import-source-list'

export const DIALER_EXPORT_PAGE_SIZE = 1000
export const DIALER_EXPORT_MAX_ROWS = 10_000

export const DIALER_EXPORT_COLUMNS = [
  'list_type',
  'county',
  'state',
  'violation_kind',
  'parcel_id',
  'case_id',
  'address',
  'owner_names',
  'amount_owed',
  'phone_e164',
  'property_id',
  'prospect_id',
  'row_status',
  'pull_date',
  'source_file_name',
  'source_list_row_id',
  'source_list_id',
  'phone_origin',
  'export_batch_id',
  'requires_licensee_disclosure',
  'ks_license_unconfirmed',
  'basis',
  'calling_window',
] as const

export interface DialerExportRow {
  list_type: string
  county: string | null
  state: string | null
  violation_kind: string | null
  parcel_id: string | null
  case_id: string | null
  address: string | null
  owner_names: string | null
  amount_owed: number | string | null
  phone_e164: string
  property_id: string | null
  prospect_id: string | null
  row_status: string
  pull_date: string
  source_file_name: string
  source_list_row_id: string
  source_list_id: string
  phone_origin: string
  export_batch_id: string
  requires_licensee_disclosure: boolean
  ks_license_unconfirmed: boolean
  basis: string
  calling_window: string | null
}

export interface DialerExportExclusion {
  reason: string
  phoneMasked: string
}

export interface DialerExportScrub {
  exportBatchId: string
  rows: DialerExportRow[]
  excludedCounts: Record<string, number>
  excludedPhones: DialerExportExclusion[]
}

export interface DialerExportFilters {
  listType: string | null
  county: string | null
  state: string | null
  violationKind: string | null
  sourceListId: string | null
  lineMode?: number | null
}

export interface DialerExportPage {
  data: DialerExportRow[] | null
  error: { message?: string } | null
}

function csvCell(column: (typeof DIALER_EXPORT_COLUMNS)[number], value: unknown): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (column !== 'phone_e164' && /^[=+\-@]/.test(text)) text = `'${text}`
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll('"', '""')}"`
  return text
}

export function dialerExportCsv(rows: readonly DialerExportRow[]): string {
  const lines = [DIALER_EXPORT_COLUMNS.join(',')]
  for (const row of rows) {
    lines.push(DIALER_EXPORT_COLUMNS.map((column) => csvCell(column, row[column])).join(','))
  }
  return `${lines.join('\n')}\n`
}

function asExportRow(value: unknown, exportBatchId: string): DialerExportRow | null {
  if (!value || typeof value !== 'object') return null
  const row = value as Record<string, unknown>
  const phone = typeof row.phone_e164 === 'string' ? row.phone_e164 : ''
  const sourceListRowId = typeof row.source_list_row_id === 'string' ? row.source_list_row_id : ''
  const sourceListId = typeof row.source_list_id === 'string' ? row.source_list_id : ''
  if (!phone || !sourceListRowId || !sourceListId) return null
  return {
    list_type: typeof row.list_type === 'string' ? row.list_type : '',
    county: typeof row.county === 'string' ? row.county : null,
    state: typeof row.state === 'string' ? row.state : null,
    violation_kind: typeof row.violation_kind === 'string' ? row.violation_kind : null,
    parcel_id: typeof row.parcel_id === 'string' ? row.parcel_id : null,
    case_id: typeof row.case_id === 'string' ? row.case_id : null,
    address: typeof row.address === 'string' ? row.address : null,
    owner_names: typeof row.owner_names === 'string' ? row.owner_names : null,
    amount_owed: typeof row.amount_owed === 'number' || typeof row.amount_owed === 'string' ? row.amount_owed : null,
    phone_e164: phone,
    property_id: typeof row.property_id === 'string' ? row.property_id : null,
    prospect_id: typeof row.prospect_id === 'string' ? row.prospect_id : null,
    row_status: typeof row.row_status === 'string' ? row.row_status : '',
    pull_date: typeof row.pull_date === 'string' ? row.pull_date : '',
    source_file_name: typeof row.source_file_name === 'string' ? row.source_file_name : '',
    source_list_row_id: sourceListRowId,
    source_list_id: sourceListId,
    phone_origin: typeof row.phone_origin === 'string' ? row.phone_origin : '',
    export_batch_id: exportBatchId,
    requires_licensee_disclosure: row.requires_licensee_disclosure === true || row.requires_licensee_disclosure === 'true',
    ks_license_unconfirmed: row.ks_license_unconfirmed === true || row.ks_license_unconfirmed === 'true' || row.state === 'KS',
    basis: typeof row.basis === 'string' && row.basis
      ? row.basis
      : (typeof row.list_type === 'string' ? row.list_type : ''),
    calling_window: typeof row.calling_window === 'string' ? row.calling_window : null,
  }
}

function maskedExportPhone(value: unknown): string | null {
  if (typeof value !== 'string') return null
  if (value === '****') return value
  if (!/^\*{6}\d{4}$/.test(value)) return null
  return value
}

function excludedCounts(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const counts: Record<string, number> = {}
  for (const [reason, count] of Object.entries(value)) {
    if (!reason || !Number.isInteger(count) || Number(count) < 0) continue
    counts[reason] = Number(count)
  }
  return counts
}

function excludedPhones(value: unknown): DialerExportExclusion[] {
  if (!Array.isArray(value)) return []
  const phones: DialerExportExclusion[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const reason = typeof row.reason === 'string' ? row.reason : ''
    const phoneMasked = maskedExportPhone(row.phone_masked)
    if (!reason || !phoneMasked) continue
    phones.push({ reason, phoneMasked })
  }
  return phones
}

export async function recordDialerExportBatch(
  db: SourceListRpcClient,
  actor: string,
  filters: DialerExportFilters,
): Promise<DialerExportScrub> {
  const lineMode = filters.lineMode ?? 1
  if (exportLineModeBlock(lineMode)) {
    throw new SourceListImportError(
      'Multi-line dialer export is suspended. Export one line at a time.',
      409,
      'multi_line_suspended',
    )
  }
  const { data, error } = await db.rpc('record_source_list_export_batch_v1', {
    p_actor: actor.trim(),
    p_list_type: filters.listType,
    p_county: filters.county,
    p_state: filters.state,
    p_violation_kind: filters.violationKind,
    p_source_list_id: filters.sourceListId,
    p_line_mode: lineMode,
  })
  if (error) throw sourceListRpcError(error)
  if (!data || typeof data !== 'object') {
    throw new SourceListImportError('The dialer export is unavailable.', 503, 'source_list_unavailable')
  }
  const payload = data as Record<string, unknown>
  const exportBatchId = typeof payload.export_batch_id === 'string' ? payload.export_batch_id : ''
  const rawRows = Array.isArray(payload.rows) ? payload.rows : null
  if (!exportBatchId || !rawRows) {
    throw new SourceListImportError('The dialer export is unavailable.', 503, 'source_list_unavailable')
  }
  const rows = rawRows.map((row) => asExportRow(row, exportBatchId)).filter((row): row is DialerExportRow => row !== null)
  if (rows.length !== rawRows.length) {
    throw new SourceListImportError('The dialer export is unavailable.', 503, 'source_list_unavailable')
  }
  return {
    exportBatchId,
    rows,
    excludedCounts: excludedCounts(payload.excluded_counts),
    excludedPhones: excludedPhones(payload.excluded_phones),
  }
}

export async function readDialerExport(
  fetchPage: (from: number, to: number) => Promise<DialerExportPage>,
): Promise<DialerExportRow[]> {
  const rows: DialerExportRow[] = []
  for (let from = 0; from < DIALER_EXPORT_MAX_ROWS; from += DIALER_EXPORT_PAGE_SIZE) {
    const page = await fetchPage(from, from + DIALER_EXPORT_PAGE_SIZE - 1)
    if (page.error) {
      throw new SourceListImportError('The dialer export is unavailable.', 503, 'source_list_unavailable')
    }
    const chunk = page.data ?? []
    rows.push(...chunk)
    if (chunk.length < DIALER_EXPORT_PAGE_SIZE) return rows
  }
  throw new SourceListImportError(
    'This export is larger than 10000 phones. Filter by list type, county, or source list and run it again.',
    409,
    'export_too_large',
  )
}
