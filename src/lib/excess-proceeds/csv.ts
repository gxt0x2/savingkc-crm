import { parseForeclosureCsvTable } from '@/lib/prospecting/foreclosure-csv'
import {
  COUNSEL_STATUSES,
  DEFAULT_SURPLUS_FEE_PCT,
  EXCESS_PROCEEDS_IMPORT_LIMIT,
  FORM_PACK_STATUSES,
  ownerNameLooksLikeEntity,
  type CounselStatus,
  type ExcessProceedsUpsertRow,
  type FormPackStatus,
} from '@/types/excess-proceeds'

export interface ExcessProceedsCsvWarning {
  row: number
  suit_no: string | null
  parcel_no: string | null
  message: string
}

export interface ExcessProceedsCsvError {
  row: number
  suit_no: string | null
  parcel_no: string | null
  message: string
}

export interface ParsedExcessProceedsCsv {
  rows: ExcessProceedsUpsertRow[]
  errors: ExcessProceedsCsvError[]
  warnings: ExcessProceedsCsvWarning[]
}

const HEADER_FIELDS = {
  'suit no': 'suit_no',
  suitno: 'suit_no',
  'suit number': 'suit_no',
  'case no': 'suit_no',
  'case number': 'suit_no',
  'parcel no': 'parcel_no',
  parcelno: 'parcel_no',
  'parcel number': 'parcel_no',
  'parcel id': 'parcel_no',
  parcel: 'parcel_no',
  owner: 'owner_name',
  'owner name': 'owner_name',
  address: 'property_address',
  'property address': 'property_address',
  situs: 'property_address',
  property: 'property_address',
  city: 'city',
  state: 'state',
  zip: 'zip',
  'zip code': 'zip',
  'date sold': 'sale_date',
  'sale date': 'sale_date',
  'sold date': 'sale_date',
  excess: 'excess_amount',
  'excess amount': 'excess_amount',
  surplus: 'excess_amount',
  'purchase price': 'purchase_price',
  'sale price': 'purchase_price',
  judgment: 'judgment_amount',
  judgement: 'judgment_amount',
  'judgment amount': 'judgment_amount',
  'judgement amount': 'judgment_amount',
  confirmed: 'confirmed_date',
  'confirmed date': 'confirmed_date',
  deed: 'deed_date',
  'deed date': 'deed_date',
  'set aside': 'set_aside_date',
  setaside: 'set_aside_date',
  'set aside date': 'set_aside_date',
  refund: 'refund_date',
  'refund date': 'refund_date',
  'excess app filed': 'excess_application_filed_date',
  'excess application filed': 'excess_application_filed_date',
  'application filed': 'excess_application_filed_date',
  'excess denied': 'excess_denied_date',
  'excess denied date': 'excess_denied_date',
  'excess paid': 'excess_paid_date',
  'excess paid date': 'excess_paid_date',
  score: 'score',
  zestimate: 'zestimate',
  'zestimate as of': 'zestimate_as_of',
  'zestimate date': 'zestimate_as_of',
  'owner is entity': 'owner_is_entity',
  'counsel status': 'counsel_status',
  'form pack status': 'form_pack_status',
  'payout ready': 'payout_ready',
  'surplus fee pct': 'surplus_fee_pct',
  'fee pct': 'surplus_fee_pct',
  'form pack url': 'form_pack_url',
  'drive url': 'form_pack_url',
} as const

type CsvField = (typeof HEADER_FIELDS)[keyof typeof HEADER_FIELDS]

const DATE_FIELDS = new Set<CsvField>([
  'sale_date',
  'confirmed_date',
  'deed_date',
  'set_aside_date',
  'refund_date',
  'excess_application_filed_date',
  'excess_denied_date',
  'excess_paid_date',
  'zestimate_as_of',
])

function headerKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_#./]+/g, ' ')
    .replace(/[^a-z0-9 ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeSuitOrParcel(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, '')
}

function blank(value: string | undefined): boolean {
  return !value || /^(-|n\/a|na|none|null)$/i.test(value.trim())
}

function parseDate(value: string): string | null {
  const trimmed = value.trim()
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (iso) return isoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  const us = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/)
  if (!us) return null
  let year = Number(us[3])
  if (year < 100) year += year >= 70 ? 1900 : 2000
  return isoDate(year, Number(us[1]), Number(us[2]))
}

function isoDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function parseMoney(value: string): number | null {
  const negative = /^\(.*\)$/.test(value.trim())
  const cleaned = value.trim().replace(/[$,\s]/g, '').replace(/[()]/g, '')
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
  const amount = Number(cleaned)
  if (!Number.isFinite(amount) || amount > 100_000_000) return null
  return negative ? -amount : amount
}

function parseBool(value: string): boolean | null {
  const normalized = value.trim().toLowerCase()
  if (['true', 'yes', 'y', '1'].includes(normalized)) return true
  if (['false', 'no', 'n', '0'].includes(normalized)) return false
  return null
}

function parseCounsel(value: string): CounselStatus | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'cleared') return 'clear'
  if (normalized === 'block') return 'blocked'
  return (COUNSEL_STATUSES as readonly string[]).includes(normalized) ? normalized as CounselStatus : null
}

function parseFormPack(value: string): FormPackStatus | null {
  const normalized = value.trim().toLowerCase()
  if (normalized === 'draft') return 'drafted'
  return (FORM_PACK_STATUSES as readonly string[]).includes(normalized) ? normalized as FormPackStatus : null
}

function splitAddress(address: string): { street: string; city: string | null; state: string | null; zip: string | null } {
  const match = address.match(/^(.*?),\s*([^,]+),\s*([A-Za-z]{2})\s+(\d{5})(?:-\d{4})?$/)
  if (!match) return { street: address, city: null, state: null, zip: null }
  return {
    street: match[1].trim(),
    city: match[2].trim(),
    state: match[3].toUpperCase(),
    zip: match[4],
  }
}

function emptyRow(suitNo: string, parcelNo: string): ExcessProceedsUpsertRow {
  return {
    suit_no: suitNo,
    parcel_no: parcelNo,
    owner_name: null,
    property_address: null,
    city: null,
    state: null,
    zip: null,
    sale_date: null,
    sale_date_provided: false,
    purchase_price: null,
    purchase_price_provided: false,
    judgment_amount: null,
    judgment_amount_provided: false,
    excess_amount: null,
    excess_amount_provided: false,
    confirmed_date: null,
    confirmed_date_provided: false,
    deed_date: null,
    deed_date_provided: false,
    set_aside_date: null,
    set_aside_date_provided: false,
    refund_date: null,
    refund_date_provided: false,
    excess_application_filed_date: null,
    excess_application_filed_date_provided: false,
    excess_denied_date: null,
    excess_denied_date_provided: false,
    excess_paid_date: null,
    excess_paid_date_provided: false,
    zestimate: null,
    zestimate_as_of: null,
    zestimate_provided: false,
    score: null,
    score_provided: false,
    owner_is_entity: false,
    owner_is_entity_provided: false,
    counsel_status: null,
    counsel_status_provided: false,
    form_pack_status: null,
    form_pack_status_provided: false,
    payout_ready: null,
    payout_ready_provided: false,
    surplus_fee_pct: null,
    surplus_fee_pct_provided: false,
    form_pack_url: null,
    form_pack_url_provided: false,
  }
}

export function parseJacksonExcessProceedsCsv(csv: string): ParsedExcessProceedsCsv {
  const table = parseForeclosureCsvTable(csv)
  const errors: ExcessProceedsCsvError[] = []
  const warnings: ExcessProceedsCsvWarning[] = []
  if (table.length === 0) return { rows: [], errors, warnings }

  const headers = table[0].map(headerKey)
  const fields = headers.map((header) => HEADER_FIELDS[header as keyof typeof HEADER_FIELDS] ?? null)
  if (!fields.includes('suit_no') || !fields.includes('parcel_no')) {
    return {
      rows: [],
      errors: [{ row: 1, suit_no: null, parcel_no: null, message: 'CSV needs Suit No and Parcel No columns.' }],
      warnings,
    }
  }

  const rows: ExcessProceedsUpsertRow[] = []
  const seen = new Set<string>()
  for (let index = 1; index < table.length; index += 1) {
    if (rows.length >= EXCESS_PROCEEDS_IMPORT_LIMIT) {
      errors.push({ row: index + 1, suit_no: null, parcel_no: null, message: `Import stops at ${EXCESS_PROCEEDS_IMPORT_LIMIT} rows.` })
      break
    }
    const cells = table[index]
    const rowNumber = index + 1
    const read = (field: CsvField) => {
      const column = fields.indexOf(field)
      return column >= 0 ? (cells[column] ?? '') : undefined
    }
    const suitRaw = read('suit_no') ?? ''
    const parcelRaw = read('parcel_no') ?? ''
    const suitNo = blank(suitRaw) ? '' : normalizeSuitOrParcel(suitRaw)
    const parcelNo = blank(parcelRaw) ? '' : normalizeSuitOrParcel(parcelRaw)
    if (!suitNo || !parcelNo) {
      errors.push({ row: rowNumber, suit_no: suitNo || null, parcel_no: parcelNo || null, message: 'Suit No and Parcel No are required.' })
      continue
    }
    const identity = `${suitNo}|${parcelNo}`
    if (seen.has(identity)) {
      errors.push({ row: rowNumber, suit_no: suitNo, parcel_no: parcelNo, message: 'Duplicate suit and parcel in this file.' })
      continue
    }
    seen.add(identity)

    const row = emptyRow(suitNo, parcelNo)
    let failed = false
    const fail = (message: string) => {
      failed = true
      errors.push({ row: rowNumber, suit_no: suitNo, parcel_no: parcelNo, message })
    }
    const applyDate = (field: CsvField, raw: string) => {
      const parsed = blank(raw) ? null : parseDate(raw)
      if (!blank(raw) && !parsed) {
        fail(`${field.replaceAll('_', ' ')} is not a date.`)
        return
      }
      if (field === 'sale_date') { row.sale_date = parsed; row.sale_date_provided = true }
      else if (field === 'confirmed_date') { row.confirmed_date = parsed; row.confirmed_date_provided = true }
      else if (field === 'deed_date') { row.deed_date = parsed; row.deed_date_provided = true }
      else if (field === 'set_aside_date') { row.set_aside_date = parsed; row.set_aside_date_provided = true }
      else if (field === 'refund_date') { row.refund_date = parsed; row.refund_date_provided = true }
      else if (field === 'excess_application_filed_date') { row.excess_application_filed_date = parsed; row.excess_application_filed_date_provided = true }
      else if (field === 'excess_denied_date') { row.excess_denied_date = parsed; row.excess_denied_date_provided = true }
      else if (field === 'excess_paid_date') { row.excess_paid_date = parsed; row.excess_paid_date_provided = true }
    }
    const applyMoney = (field: 'purchase_price' | 'judgment_amount' | 'excess_amount', raw: string) => {
      if (field === 'purchase_price') row.purchase_price_provided = true
      if (field === 'judgment_amount') row.judgment_amount_provided = true
      if (field === 'excess_amount') row.excess_amount_provided = true
      if (blank(raw)) return
      const parsed = parseMoney(raw)
      if (parsed === null || parsed < 0) {
        fail(`${field.replaceAll('_', ' ')} is not a dollar amount.`)
        return
      }
      row[field] = parsed
    }

    for (const field of fields) {
      if (!field || field === 'suit_no' || field === 'parcel_no' || field === 'zestimate' || field === 'zestimate_as_of') continue
      const raw = read(field)
      if (raw === undefined) continue
      if (DATE_FIELDS.has(field)) applyDate(field, raw)
      else if (field === 'purchase_price' || field === 'judgment_amount' || field === 'excess_amount') applyMoney(field, raw)
    }
    if (failed) continue

    const owner = read('owner_name')
    if (owner !== undefined && !blank(owner)) row.owner_name = owner.trim().slice(0, 200)
    const address = read('property_address')
    if (address !== undefined && !blank(address)) {
      const split = splitAddress(address.trim())
      row.property_address = split.street.slice(0, 300)
      row.city = split.city
      row.state = split.state
      row.zip = split.zip
    }
    const city = read('city')
    const state = read('state')
    const zip = read('zip')
    if (city !== undefined && !blank(city)) row.city = city.trim().slice(0, 80)
    if (state !== undefined && !blank(state)) row.state = state.trim().slice(0, 2).toUpperCase()
    if (zip !== undefined && !blank(zip)) row.zip = zip.trim().slice(0, 10)

    const entity = read('owner_is_entity')
    if (entity !== undefined) {
      row.owner_is_entity_provided = true
      if (!blank(entity)) {
        const parsed = parseBool(entity)
        if (parsed === null) {
          fail('Owner is entity must be yes or no.')
          continue
        }
        row.owner_is_entity = parsed
      }
    } else if (row.owner_name) {
      row.owner_is_entity = ownerNameLooksLikeEntity(row.owner_name)
      row.owner_is_entity_provided = true
    }

    const counsel = read('counsel_status')
    if (counsel !== undefined) {
      row.counsel_status_provided = true
      if (!blank(counsel)) {
        const parsed = parseCounsel(counsel)
        if (!parsed) {
          fail('Counsel status must be pending, clear, or blocked.')
          continue
        }
        row.counsel_status = parsed
      }
    }
    const formPack = read('form_pack_status')
    if (formPack !== undefined) {
      row.form_pack_status_provided = true
      if (!blank(formPack)) {
        const parsed = parseFormPack(formPack)
        if (!parsed) {
          fail('Form pack status must be none, drafted, or signed.')
          continue
        }
        row.form_pack_status = parsed
      }
    }
    const payout = read('payout_ready')
    if (payout !== undefined) {
      row.payout_ready_provided = true
      if (!blank(payout)) {
        const parsed = parseBool(payout)
        if (parsed === null) {
          fail('Payout ready must be yes or no.')
          continue
        }
        row.payout_ready = parsed
      }
    }
    const fee = read('surplus_fee_pct')
    if (fee !== undefined) {
      row.surplus_fee_pct_provided = true
      if (!blank(fee)) {
        const parsed = Number(fee.trim().replace('%', ''))
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
          fail('Surplus fee percent must be between 0 and 100.')
          continue
        }
        row.surplus_fee_pct = parsed
      } else {
        row.surplus_fee_pct = DEFAULT_SURPLUS_FEE_PCT
      }
    }
    const score = read('score')
    if (score !== undefined) {
      row.score_provided = true
      if (!blank(score)) {
        const parsed = Number(score.trim())
        if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1000) {
          fail('Score must be a number.')
          continue
        }
        row.score = parsed
      }
    }
    const formUrl = read('form_pack_url')
    if (formUrl !== undefined) {
      row.form_pack_url_provided = true
      if (!blank(formUrl)) {
        const url = formUrl.trim()
        if (!/^https?:\/\//i.test(url) || url.length > 500) {
          fail('Drive form pack link must be an http(s) URL.')
          continue
        }
        row.form_pack_url = url
      }
    }

    const zestimateRaw = read('zestimate')
    const zestimateAsOfRaw = read('zestimate_as_of')
    const zestimateColumn = zestimateRaw !== undefined
    const asOfColumn = zestimateAsOfRaw !== undefined
    if (zestimateColumn || asOfColumn) {
      const zestimateBlank = !zestimateColumn || blank(zestimateRaw)
      const asOfBlank = !asOfColumn || blank(zestimateAsOfRaw)
      if (zestimateBlank && asOfBlank) {
        row.zestimate_provided = zestimateColumn && asOfColumn
      } else if (zestimateBlank || asOfBlank || !zestimateColumn || !asOfColumn) {
        warnings.push({
          row: rowNumber,
          suit_no: suitNo,
          parcel_no: parcelNo,
          message: 'Zestimate left blank. A value is stored only with an as-of date, and this file does not invent one.',
        })
      } else {
        const amount = parseMoney(zestimateRaw)
        const asOf = parseDate(zestimateAsOfRaw)
        if (amount === null || amount < 0 || !asOf) {
          fail('Zestimate needs a dollar amount and an as-of date.')
          continue
        }
        row.zestimate = amount
        row.zestimate_as_of = asOf
        row.zestimate_provided = true
      }
    }

    rows.push(row)
  }

  return { rows, errors, warnings }
}
