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
  addrNorm: string
}

const ADDRESS = ['address', 'full_address', 'street_address', 'property_address', 'unparsedaddress']
const ZIP = ['zip', 'zip_code', 'zipcode', 'postal_code', 'postalcode']
const STATUS = ['st', 'status', 'standard_status', 'standardstatus', 'mlsstatus']
const CLOSED = ['close_dt', 'close_date', 'closedate', 'closed_date', 'sold_date', 'date_sold']
const EXPIRED = ['expire_dt', 'expire_date', 'expiration_date', 'off_market_date', 'status_date']
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

export function fileSha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/**
 * One Heartland Matrix saved-search export for the whole metro.
 * The file is not fetched. The caller supplies the CSV text.
 */
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
      addrNorm: normalizeMarketAddress(address),
    }
  })
}
