import { createHash } from 'node:crypto'
import { parseCsv } from '@/lib/parse-csv'

export const SOURCE_LIST_TYPES = [
  'tax_delinquent',
  'probate_estate',
  'probate_no_property',
  'foreclosure',
  'code_violation',
] as const

export const SOURCE_LIST_COUNTIES = ['jackson', 'clay', 'platte', 'johnson', 'wyandotte'] as const
export const SOURCE_LIST_STATUSES = [
  'new',
  'needs_check',
  'ready',
  'excluded_entity',
  'dropped',
  'loaded_to_dialer',
] as const

export const MAX_SOURCE_LIST_ROWS = 5000
export const MAX_SOURCE_LIST_BYTES = 5_000_000

export type SourceListType = (typeof SOURCE_LIST_TYPES)[number]
export type SourceListCounty = (typeof SOURCE_LIST_COUNTIES)[number]
export type SourceListStatus = (typeof SOURCE_LIST_STATUSES)[number]
export type SourceListState = 'MO' | 'KS'
export type CodeViolationKind = 'dangerous_building' | 'board_up' | 'structural'

const LIST_TYPE_ALIASES: Record<string, SourceListType> = {
  tax_delinquent: 'tax_delinquent',
  tax: 'tax_delinquent',
  probate_estate: 'probate_estate',
  probate: 'probate_estate',
  estate: 'probate_estate',
  case_net: 'probate_estate',
  casenet: 'probate_estate',
  probate_no_property: 'probate_no_property',
  no_property: 'probate_no_property',
  foreclosure: 'foreclosure',
  code_violation: 'code_violation',
  code: 'code_violation',
  violation: 'code_violation',
}

const VIOLATION_ALIASES: Record<string, CodeViolationKind> = {
  dangerous_building: 'dangerous_building',
  dangerous: 'dangerous_building',
  board_up: 'board_up',
  boardup: 'board_up',
  structural: 'structural',
}

const MO_COUNTIES = new Set<SourceListCounty>(['jackson', 'clay', 'platte'])
const KS_COUNTIES = new Set<SourceListCounty>(['johnson', 'wyandotte'])
const CASE_FIRST = new Set<SourceListType>(['probate_estate', 'probate_no_property', 'foreclosure'])

export class SourceListImportError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly row?: number,
  ) {
    super(message)
    this.name = 'SourceListImportError'
  }
}

export interface SourceListLane {
  listType: SourceListType
  county: SourceListCounty | null
  state: SourceListState | null
  violationKind: CodeViolationKind | null
}

export interface SourceListImportRequest {
  listType: string
  county?: string | null
  state?: string | null
  violationKind?: string | null
  pullDate: string
  sourceUrl?: string | null
  notes?: string | null
  fileName: string
  csvText: string
}

export interface SourceListRpcRow {
  parcel_id: string | null
  case_id: string | null
  address: string | null
  owner_names: string | null
  amount_owed: string | null
  phones: string[]
  raw: Record<string, string>
}

export interface SourceListRpcPayload {
  p_list_type: SourceListType
  p_county: SourceListCounty | null
  p_state: SourceListState | null
  p_violation_kind: CodeViolationKind | null
  p_pull_date: string
  p_source_url: string | null
  p_notes: string | null
  p_source_file_name: string
  p_source_file_sha256: string
  p_source_file_bytes: number
  p_imported_by: string
  p_rows: SourceListRpcRow[]
}

function token(value: string): string {
  return value.trim().toLowerCase().replace(/[.\s-]+/g, '_')
}

function clean(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  const text = value.trim().replace(/\s+/g, ' ')
  return text ? text.slice(0, maxLength) : null
}

function first(record: Record<string, string>, keys: string[]): string | null {
  for (const key of keys) {
    const value = clean(record[key], 500)
    if (value) return value
  }
  return null
}

function identityBody(value: string | null, rowNumber: number, label: string): string | null {
  if (!value) return null
  const body = value.toUpperCase().replace(/\s+/g, '')
  if (!/^[A-Z0-9][A-Z0-9:./_-]{0,79}$/.test(body)) {
    throw new SourceListImportError(`${label} on row ${rowNumber} is not a usable id`, 400, 'invalid_match_key', rowNumber)
  }
  return body
}

export function sourceListMatchKey(
  listType: SourceListType,
  parcelId: string | null,
  caseId: string | null,
): string | null {
  if (CASE_FIRST.has(listType)) {
    if (caseId) return `case:${caseId}`
    if (parcelId) return `parcel:${parcelId}`
    return null
  }
  if (parcelId) return `parcel:${parcelId}`
  if (caseId) return `case:${caseId}`
  return null
}

export function normalizeSourceListLane(input: {
  listType: string
  county?: string | null
  state?: string | null
  violationKind?: string | null
}): SourceListLane {
  const listType = LIST_TYPE_ALIASES[token(input.listType || '')]
  if (!listType) {
    throw new SourceListImportError(
      'List type must be tax delinquent, probate estate, probate no-property, foreclosure, or code violation.',
      400,
      'invalid_lane',
    )
  }

  const countyToken = token(input.county || '')
  const county = countyToken
    ? SOURCE_LIST_COUNTIES.find((item) => item === countyToken) ?? null
    : null
  if (countyToken && !county) {
    throw new SourceListImportError(
      'County must be Jackson, Clay, Platte, Johnson, or Wyandotte.',
      400,
      'invalid_lane',
    )
  }

  const stateToken = token(input.state || '')
  const state = stateToken === 'mo' || stateToken === 'missouri'
    ? 'MO'
    : stateToken === 'ks' || stateToken === 'kansas'
      ? 'KS'
      : null
  if (stateToken && !state) {
    throw new SourceListImportError('State must be MO or KS.', 400, 'invalid_lane')
  }

  const violationToken = token(input.violationKind || '')
  const violationKind = violationToken ? VIOLATION_ALIASES[violationToken] ?? null : null
  if (violationToken && !violationKind) {
    throw new SourceListImportError(
      'Code violation kind must be dangerous building, board-up, or structural.',
      400,
      'invalid_lane',
    )
  }

  if (county && state && ((MO_COUNTIES.has(county) && state !== 'MO') || (KS_COUNTIES.has(county) && state !== 'KS'))) {
    throw new SourceListImportError(`${county} belongs with ${MO_COUNTIES.has(county) ? 'MO' : 'KS'}.`, 400, 'invalid_lane')
  }
  if (county && !state) {
    throw new SourceListImportError('Choose MO or KS with the county.', 400, 'invalid_lane')
  }

  if (listType === 'tax_delinquent' && (!county || !state)) {
    throw new SourceListImportError('A tax-delinquent list needs a county and a state.', 400, 'invalid_lane')
  }
  if (listType === 'foreclosure' && !state) {
    throw new SourceListImportError('A foreclosure list needs MO or KS.', 400, 'invalid_lane')
  }
  if (listType === 'code_violation') {
    if (!violationKind) {
      throw new SourceListImportError(
        'A code-violation list needs a kind: dangerous building, board-up, or structural.',
        400,
        'invalid_lane',
      )
    }
    if (state !== 'MO' || (county !== null && !MO_COUNTIES.has(county))) {
      throw new SourceListImportError(
        'Code-violation lists in this import are Kansas City, Missouri. Use Jackson, Clay, Platte, or leave the county blank.',
        400,
        'invalid_lane',
      )
    }
  } else if (violationKind) {
    throw new SourceListImportError('Violation kind is only used for code-violation lists.', 400, 'invalid_lane')
  }
  if ((listType === 'probate_estate' || listType === 'probate_no_property') && state === 'KS') {
    throw new SourceListImportError('Case.net probate lists are Missouri.', 400, 'invalid_lane')
  }

  return { listType, county, state, violationKind: listType === 'code_violation' ? violationKind : null }
}

function pullDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new SourceListImportError('Pull date must be YYYY-MM-DD.', 400, 'invalid_pull_date')
  }
  const [year, month, day] = value.split('-').map(Number)
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    throw new SourceListImportError('Pull date must be YYYY-MM-DD.', 400, 'invalid_pull_date')
  }
  if (year < 2000 || year > 2100) {
    throw new SourceListImportError('Pull date is out of range.', 400, 'invalid_pull_date')
  }
  return value
}

function fileName(value: string): string {
  const base = value.trim().split(/[\\/]/).pop()?.replace(/[^\w.\- ()]+/g, '_') ?? ''
  if (!base || base === '.' || base === '..') {
    throw new SourceListImportError('A source file name is required.', 400, 'invalid_file')
  }
  if (/\.xlsx?$/i.test(base)) {
    throw new SourceListImportError(
      'Save the workbook as a CSV file first. This import reads CSV only.',
      400,
      'csv_required',
    )
  }
  return base.slice(0, 200)
}

function amount(value: string, rowNumber: number): string | null {
  const cleaned = value.replace(/[$,\s]/g, '')
  if (!cleaned) return null
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) {
    throw new SourceListImportError(`Amount owed on row ${rowNumber} is not a number`, 400, 'invalid_amount', rowNumber)
  }
  return cleaned
}

function addressOf(record: Record<string, string>): string | null {
  const street = first(record, ['address', 'situs', 'situs_address', 'property_address', 'site_address', 'street', 'street_address'])
  const city = clean(record.city || record.situs_city, 120)
  const state = clean(record.state || record.situs_state, 20)
  const zip = clean(record.zip || record.situs_zip || record.postal_code || record.zip_code, 20)
  if (street && city && street.toLowerCase().includes(city.toLowerCase())) return street.slice(0, 500)
  const composed = [street, city, state, zip].filter(Boolean).join(', ')
  return composed ? composed.slice(0, 500) : null
}

function ownersOf(record: Record<string, string>): string | null {
  const named = first(record, ['owner_names', 'owner_name', 'owner'])
  if (named) return named.slice(0, 500)
  const joined = [clean(record.owner_1, 200), clean(record.owner_2, 200)].filter(Boolean).join(' & ')
  return joined ? joined.slice(0, 500) : null
}

function phonesOf(record: Record<string, string>, rowNumber: number): string[] {
  const keys = ['phone', 'phone_1', 'phone_2', 'phone_3', 'mobile', 'cell', 'owner_phone', 'phone1', 'phone2', 'phone3']
  const phones: string[] = []
  for (const key of keys) {
    const value = record[key]?.trim().replace(/\s+/g, ' ') ?? ''
    if (!value || phones.includes(value)) continue
    if (value.length > 40) {
      throw new SourceListImportError(`Phone on row ${rowNumber} is too long`, 400, 'invalid_phone', rowNumber)
    }
    phones.push(value)
  }
  if (phones.length > 8) {
    throw new SourceListImportError(`Row ${rowNumber} has more than 8 phone numbers`, 400, 'invalid_phone', rowNumber)
  }
  return phones
}

export function buildSourceListImport(actor: string, request: SourceListImportRequest): SourceListRpcPayload {
  const importedBy = actor.trim()
  if (!importedBy || importedBy.length > 320) {
    throw new SourceListImportError('The importer name is missing.', 400, 'invalid_actor')
  }
  const lane = normalizeSourceListLane(request)
  const name = fileName(request.fileName)
  const csv = request.csvText.replace(/^\uFEFF/, '')
  const bytes = Buffer.byteLength(csv)
  if (!csv.trim()) throw new SourceListImportError('The CSV is empty.', 400, 'empty_csv')
  if (bytes > MAX_SOURCE_LIST_BYTES) {
    throw new SourceListImportError('CSV imports are limited to 5 MB.', 400, 'csv_too_large')
  }
  const sourceUrl = clean(request.sourceUrl, 2000)
  if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
    throw new SourceListImportError('Source URL must start with http:// or https://.', 400, 'invalid_source_url')
  }
  const notes = clean(request.notes, 2000)
  const parsed = parseCsv(csv)
  if (parsed.length === 0) throw new SourceListImportError('The CSV has no data rows.', 400, 'empty_csv')
  if (parsed.length > MAX_SOURCE_LIST_ROWS) {
    throw new SourceListImportError(`Import at most ${MAX_SOURCE_LIST_ROWS} rows at a time.`, 400, 'too_many_rows')
  }

  const byKey = new Map<string, SourceListRpcRow>()
  parsed.forEach((record, index) => {
    const rowNumber = index + 2
    const parcelId = identityBody(
      first(record, ['parcel_id', 'parcel', 'apn', 'parcel_number', 'parcel_no', 'parcelid']),
      rowNumber,
      'Parcel id',
    )
    const caseId = identityBody(
      first(record, ['case_id', 'case_number', 'case', 'casenumber', 'estate_number', 'estate_no', 'cause_number', 'cause_no', 'probate_case']),
      rowNumber,
      'Case id',
    )
    const matchKey = sourceListMatchKey(lane.listType, parcelId, caseId)
    if (!matchKey) {
      throw new SourceListImportError(`Row ${rowNumber} needs a parcel id or a case id`, 400, 'missing_match_key', rowNumber)
    }
    byKey.set(matchKey, {
      parcel_id: parcelId,
      case_id: caseId,
      address: addressOf(record),
      owner_names: ownersOf(record),
      amount_owed: amount(
        first(record, ['amount_owed', 'amount', 'cumulative_due', 'total_due', 'taxes_due', 'balance', 'amount_due', 'total_amount_owed']) ?? '',
        rowNumber,
      ),
      phones: phonesOf(record, rowNumber),
      raw: record,
    })
  })

  return {
    p_list_type: lane.listType,
    p_county: lane.county,
    p_state: lane.state,
    p_violation_kind: lane.violationKind,
    p_pull_date: pullDate(request.pullDate.trim()),
    p_source_url: sourceUrl,
    p_notes: notes,
    p_source_file_name: name,
    p_source_file_sha256: createHash('sha256').update(csv).digest('hex'),
    p_source_file_bytes: bytes,
    p_imported_by: importedBy,
    p_rows: [...byKey.values()],
  }
}
