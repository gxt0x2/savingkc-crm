import { normalizePhoneToE164 } from '@/lib/phone-normalize'

export interface HeirSyncRow {
  phone: string
  phone_type: string | null
  phone_connected: 'connected' | 'disconnected' | null
  contact_name: string
  relationship: string
  contact_address: string | null
}

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const clean = value.trim().replace(/\s+/g, ' ')
  return clean ? clean.slice(0, maxLength) : null
}

function firstAddress(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null
  const first = value[0]
  if (typeof first === 'string') return cleanText(first, 500)
  if (!first || typeof first !== 'object' || Array.isArray(first)) return null
  const address = first as Record<string, unknown>
  return cleanText(
    [address.street, address.city, address.state, address.zip]
      .filter((part): part is string => typeof part === 'string' && Boolean(part.trim()))
      .join(', '),
    500,
  )
}

/** Convert the untrusted provider response to a bounded replacement payload. */
export function parseHeirSyncRows(payload: unknown): HeirSyncRow[] {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return []
  const relatives = (payload as Record<string, unknown>).relatives
  if (!Array.isArray(relatives)) return []
  if (relatives.length > 100) throw new Error('Skip trace returned too many relatives')

  const rows: HeirSyncRow[] = []
  const seenPhones = new Set<string>()

  for (const relative of relatives) {
    if (!relative || typeof relative !== 'object' || Array.isArray(relative)) continue
    const record = relative as Record<string, unknown>
    const contactName = cleanText(record.name, 200)
    if (!contactName) continue
    const relationship = (cleanText(record.relationship, 100) ?? 'relative').toLowerCase()
    if (relationship === 'owner') continue
    const phones = record.phones
    if (!Array.isArray(phones)) continue
    if (phones.length > 20) throw new Error('Skip trace returned too many phones for one relative')
    const address = firstAddress(record.addresses)

    for (const phoneValue of phones) {
      if (!phoneValue || typeof phoneValue !== 'object' || Array.isArray(phoneValue)) continue
      const phoneRecord = phoneValue as Record<string, unknown>
      const phone = normalizePhoneToE164(
        typeof phoneRecord.number === 'string' || typeof phoneRecord.number === 'number'
          ? phoneRecord.number
          : null,
      )
      if (!phone || seenPhones.has(phone)) continue
      seenPhones.add(phone)
      rows.push({
        phone,
        phone_type: cleanText(phoneRecord.type, 50),
        phone_connected: typeof phoneRecord.is_connected === 'boolean'
          ? phoneRecord.is_connected ? 'connected' : 'disconnected'
          : null,
        contact_name: contactName,
        relationship,
        contact_address: address,
      })
      if (rows.length > 500) throw new Error('Skip trace returned too many phone records')
    }
  }

  return rows
}
