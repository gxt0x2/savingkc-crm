import { normalizePhoneToE164 } from '@/lib/phone-normalize'

export const MAX_PROSPECT_IMPORT_ROWS = 500

export interface ProspectImportRow {
  full_name: string | null
  phone: string
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  source: string
  station: 'new'
  classification: null
  priority: 'cold'
  is_parked: false
  pipeline_intent_source: null
}

export class ProspectImportError extends Error {
  constructor(message: string, readonly row?: number) {
    super(message)
    this.name = 'ProspectImportError'
  }
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim().replace(/\s+/g, ' ')
  return clean ? clean.slice(0, maxLength) : null
}

function first(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return null
}

export function parseProspectImportRows(payload: unknown): ProspectImportRow[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ProspectImportError('Invalid import request')
  }
  const rows = (payload as Record<string, unknown>).rows
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new ProspectImportError('Add at least one CSV row')
  }
  if (rows.length > MAX_PROSPECT_IMPORT_ROWS) {
    throw new ProspectImportError(`Import at most ${MAX_PROSPECT_IMPORT_ROWS} contacts at a time`)
  }

  const phones = new Set<string>()
  return rows.map((value, index) => {
    const rowNumber = index + 2
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ProspectImportError('Row is not a contact record', rowNumber)
    }
    const record = value as Record<string, unknown>
    const rawPhone = first(record, ['phone', 'phone_number', 'mobile', 'telephone'])
    const phone = normalizePhoneToE164(
      typeof rawPhone === 'string' || typeof rawPhone === 'number' ? rawPhone : null,
    )
    if (!phone) throw new ProspectImportError('A valid US phone number is required', rowNumber)
    if (phones.has(phone)) throw new ProspectImportError('Phone number is duplicated in this file', rowNumber)
    phones.add(phone)

    const firstName = cleanText(first(record, ['first_name', 'firstname']), 100)
    const lastName = cleanText(first(record, ['last_name', 'lastname']), 100)
    const fullName = cleanText(first(record, ['full_name', 'name']), 200)
      ?? cleanText([firstName, lastName].filter(Boolean).join(' '), 200)
    const email = cleanText(first(record, ['email', 'email_address']), 320)?.toLowerCase() ?? null
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      throw new ProspectImportError('Email address is invalid', rowNumber)
    }

    return {
      full_name: fullName,
      phone,
      email,
      property_address: cleanText(first(record, ['property_address', 'address', 'street']), 500),
      city: cleanText(record.city, 120),
      state: cleanText(record.state, 50),
      zip: cleanText(first(record, ['zip', 'postal_code', 'zipcode']), 20),
      source: cleanText(record.source, 100) ?? 'csv_import',
      station: 'new',
      classification: null,
      priority: 'cold',
      is_parked: false,
      pipeline_intent_source: null,
    }
  })
}
