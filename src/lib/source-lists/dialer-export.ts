import { SourceListImportError } from '@/lib/source-lists/csv'

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
