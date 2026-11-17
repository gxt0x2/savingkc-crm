import { createHash } from 'node:crypto'
import { parseCsv } from '@/lib/parse-csv'
import { normalizeMarketAddress, normalizeParcelId, zip5 } from '@/lib/market-check/address'

export class MarketCheckFileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarketCheckFileError'
  }
}

export interface MatrixRow {
  mlsNumber: string
  statusRaw: string
  address: string
  zip5: string
  parcelId: string | null
  listPrice: number | null
  closeDate: string | null
  expireDate: string | null
  dom: number | null
  cdom: number | null
  listingAgentName: string | null
  listingAgentPhone: string | null
  addrNorm: string
}

const ADDRESS = ['address', 'full_address', 'street_address', 'property_address', 'unparsedaddress']
const ZIP = ['zip', 'zip_code', 'zipcode', 'postal_code', 'postalcode']
const STATUS = ['st', 'status', 'standard_status', 'standardstatus', 'mlsstatus']
const CLOSED = ['close_dt', 'close_date', 'closedate', 'closed_date', 'sold_date', 'date_sold']
const EXPIRED = ['exp_dt', 'expire_dt', 'expire_date', 'expiration_date', 'exp_date', 'off_market_date', 'off_market_dt', 'status_date']
const DOM = ['dom', 'days_on_market', 'daysonmarket']
const CDOM = ['cdom', 'cumulative_days_on_market', 'cumulative_dom']
const AGENT_NAME = [
  'list_agent_full_name', 'listing_agent_name', 'listing_agent', 'list_agent_name', 'list_agent', 'la_name', 'agent_name',
]
const AGENT_PHONE = [
  'list_agent_direct_work_phone', 'list_agent_business_phone', 'agent_business_phone',
  'list_agent_phone', 'listing_agent_phone', 'list_agent_direct_phone', 'la_phone', 'agent_phone',
]
const MLS = ['mls_#', 'mls_number', 'mls_num', 'listingid', 'ml_number', 'mls']
const PRICE = ['list_price', 'listprice', 'current_price', 'price', 'asking_price']
const PARCEL = ['parcel_id', 'apn', 'parcel', 'parcel_number']

function pick(row: Record<string, string>, names: string[]): string {
  for (const name of names) {
    const value = row[name]
    if (value && value.trim()) return value.trim()
  }
  return ''
}

export function isoDate(value: string): string | null {
  const text = value.trim()
  if (!text) return null
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const us = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (us) return `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}`
  return null
}

function money(value: string): number | null {
  const digits = value.replace(/[$,\s]/g, '')
  if (!digits) return null
  const parsed = Number(digits)
  if (!Number.isFinite(parsed) || parsed < 0) return null
  return parsed
}

/** Whole days only. A blank cell stays null so the 90+ lane does not treat it as zero. */
export function wholeDays(value: string): number | null {
  const match = value.trim().replace(/,/g, '').match(/^(\d{1,5})(?:\.0+)?$/)
  if (!match) return null
  return Number(match[1])
}

function agentText(value: string, max: number): string | null {
  const text = value.trim().replace(/\s+/g, ' ')
  if (!text) return null
  return text.slice(0, max)
}

export function fileSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * One Heartland Matrix saved-search export for the whole metro.
 * The file is not fetched. The caller supplies the CSV text.
 */
export function matrixCsvHasExpireColumn(csvText: string): boolean {
  const header = (csvText.split(/\r?\n/)[0] ?? '').toLowerCase().replace(/\s+/g, '_')
  return EXPIRED.some((name) => header.includes(name))
}

export function parseMatrixCsv(csvText: string): MatrixRow[] {
  const table = parseCsv(csvText)
  if (!table.length) throw new MarketCheckFileError('The Matrix export has no rows.')
  const sample = table[0]
  const hasStatus = STATUS.some((name) => name in sample)
  const hasZip = ZIP.some((name) => name in sample)
  const hasAddress = ADDRESS.some((name) => name in sample)
  if (!hasStatus || !hasZip || !hasAddress) {
    throw new MarketCheckFileError('The Matrix export needs status, zip, and address columns.')
  }
  return table.map((row) => {
    const address = pick(row, ADDRESS)
    const parcel = normalizeParcelId(pick(row, PARCEL))
    return {
      mlsNumber: pick(row, MLS),
      statusRaw: pick(row, STATUS),
      address,
      zip5: zip5(pick(row, ZIP)),
      parcelId: parcel || null,
      listPrice: money(pick(row, PRICE)),
      closeDate: isoDate(pick(row, CLOSED)),
      expireDate: isoDate(pick(row, EXPIRED)),
      dom: wholeDays(pick(row, DOM)),
      cdom: wholeDays(pick(row, CDOM)),
      listingAgentName: agentText(pick(row, AGENT_NAME), 200),
      listingAgentPhone: agentText(pick(row, AGENT_PHONE), 80),
      addrNorm: normalizeMarketAddress(address),
    }
  })
}
