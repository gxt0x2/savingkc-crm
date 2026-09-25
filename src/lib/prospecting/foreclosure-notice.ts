import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/** Legal filing types. Outreach (mailers, texts, calls) is a separate count. */
export const FORECLOSURE_NOTICE_TYPES = ['lis_pendens', 'nod', 'notice_of_sale', 'sheriff_sale'] as const

export const SALE_STATUSES = ['unknown', 'scheduled', 'postponed', 'cancelled', 'sold', 'reinstated'] as const

export type ForeclosureNoticeType = (typeof FORECLOSURE_NOTICE_TYPES)[number]
export type SaleStatus = (typeof SALE_STATUSES)[number]

export interface NoticeTimelineEvent {
  at: string
  field: 'sale_date' | 'attorney'
  from: string | null
  to: string | null
}

export interface IngestControl {
  county: string
  noticeType: ForeclosureNoticeType
  paused: boolean
  updatedSince: string | null
}

export const NOTICE_TYPE_LABELS: Record<ForeclosureNoticeType, string> = {
  lis_pendens: 'Lis pendens',
  nod: 'NOD',
  notice_of_sale: 'Notice of sale',
  sheriff_sale: 'Sheriff sale',
}

export const SALE_STATUS_LABELS: Record<SaleStatus, string> = {
  unknown: 'Unknown',
  scheduled: 'Scheduled',
  postponed: 'Postponed',
  cancelled: 'Cancelled',
  sold: 'Sold',
  reinstated: 'Reinstated',
}

const DEFAULT_INGEST_COUNTIES = ['jackson', 'johnson'] as const

/** Name patterns that gate LLC, trust, and estate owners before any phone is stored. */
export function ownerNameSignals(name: string | null | undefined): Array<'estate' | 'trust' | 'llc'> {
  const value = text(name)
  if (!value) return []
  const signals: Array<'estate' | 'trust' | 'llc'> = []
  if (/\bestate\b/i.test(value)) signals.push('estate')
  if (/\btrust(ee)?\b/i.test(value)) signals.push('trust')
  if (/\b(l\.?\s*l\.?\s*c\.?|limited liability|inc\.?|corp\.?|corporation|holdings|partners|l\.?\s*l\.?\s*p\.?|\blp\b)\b/i.test(value)) signals.push('llc')
  return signals
}

/**
 * Absentee and entity signals recorded before phones.
 * Relatives skip is intentionally not applied here.
 */
export function absenteeOwnerSignal(input: {
  ownerEntity: string
  mailingAddress?: string | null
  situs?: string | null
  ownerState?: string | null
  propertyState?: string | null
}): { absentee: boolean; signals: string[] } {
  const signals: string[] = []
  if (input.ownerEntity === 'llc' || input.ownerEntity === 'trust' || input.ownerEntity === 'estate') {
    signals.push(input.ownerEntity)
  }
  const mailing = text(input.mailingAddress)?.toLowerCase()
  const situs = text(input.situs)?.toLowerCase()
  if (mailing && situs && mailing !== situs) signals.push('mailing_differs')
  const ownerState = text(input.ownerState)?.toUpperCase()
  const propertyState = text(input.propertyState)?.toUpperCase()
  if (ownerState && propertyState && ownerState !== propertyState) signals.push('out_of_state')
  return { absentee: signals.length > 0, signals }
}

/** Outreach is mailers, texts, and calls. The legal filing is noticeType. */
export function parseOutreachCount(raw: unknown): { count: number; warning: string | null } {
  if (raw == null || raw === '') return { count: 0, warning: null }
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(value) || value < 0 || value > 999) {
    return { count: 0, warning: 'Outreach was ignored because it was not a count from 0 to 999.' }
  }
  return { count: Math.floor(value), warning: null }
}

export function loanToValuePercent(value: number | null, debt: number | null): number | null {
  if (value == null || debt == null || value <= 0 || debt < 0) return null
  return Math.round((debt / value) * 1000) / 10
}

export function formatLtv(percent: number | null): string {
  if (percent == null) return '—'
  return `${percent}%`
}

/** Which legal notice this is (1st, 2nd, 3rd). Not the outreach count. */
export function parseNoticeNumber(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const value = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(value)) return null
  const count = Math.floor(value)
  if (count < 1 || count > 20) return null
  return count
}

export function formatNoticeOrdinal(count: number | null): string | null {
  if (count == null) return null
  const mod100 = count % 100
  const mod10 = count % 10
  const suffix = mod100 >= 11 && mod100 <= 13 ? 'th' : mod10 === 1 ? 'st' : mod10 === 2 ? 'nd' : mod10 === 3 ? 'rd' : 'th'
  return `${count}${suffix} notice`
}

export type AuctionUrgency = 'urgent' | 'soon' | 'near' | 'later' | 'none'

/** Days-to-auction color. Overdue stays urgent. */
export function auctionUrgency(days: number | null): AuctionUrgency {
  if (days == null) return 'none'
  if (days <= 7) return 'urgent'
  if (days <= 14) return 'soon'
  if (days <= 30) return 'near'
  return 'later'
}

export const SKIP_RELATIONSHIPS = ['subject', 'spouse', 'child', 'heir', 'other'] as const
export type SkipRelationship = (typeof SKIP_RELATIONSHIPS)[number]

export interface SkipPhone {
  phone: string
  contactName: string
  relationship: SkipRelationship
  rank: number
}

export const SKIP_RELATIONSHIP_LABELS: Record<SkipRelationship, string> = {
  subject: 'Subject',
  spouse: 'Spouse',
  child: 'Child',
  heir: 'Heir',
  other: 'Contact',
}

const SKIP_CLOSENESS: Record<SkipRelationship, number> = {
  subject: 0,
  spouse: 1,
  child: 2,
  heir: 3,
  other: 4,
}

/** Fictional sandbox contacts. Not a relatives-skip vendor feed. */
const SANDBOX_SKIP_EXTRAS: Array<Omit<SkipPhone, 'rank'>> = [
  { phone: '+19135550101', contactName: 'Morgan Dodson', relationship: 'spouse' },
  { phone: '+19135550102', contactName: 'Riley Dodson', relationship: 'child' },
]

/**
 * Ranked phone inventory, closest to the subject first.
 * Non-person and below-floor rows pass allow:false and stay empty.
 * Sandbox extras apply only when sandbox is true.
 */
export function buildRankedSkipPhones(input: {
  allow: boolean
  ownerName: string | null
  phones: string[]
  raw?: unknown
  sandbox?: boolean
}): SkipPhone[] {
  if (!input.allow) return []
  const rows: Array<Omit<SkipPhone, 'rank'>> = []
  const push = (phoneRaw: unknown, contactName: unknown, relationship: SkipRelationship) => {
    const phone = normalizePhoneToE164(typeof phoneRaw === 'number' ? String(phoneRaw) : text(phoneRaw))
    if (!phone || rows.some((row) => row.phone === phone)) return
    rows.push({
      phone,
      contactName: text(contactName) || (relationship === 'subject' ? text(input.ownerName) : null) || 'Contact',
      relationship,
    })
  }
  if (input.phones[0]) push(input.phones[0], input.ownerName, 'subject')
  for (const entry of skipEntries(input.raw)) push(entry.phone, entry.contactName, entry.relationship)
  for (const phone of input.phones.slice(1)) push(phone, null, 'other')
  if (input.sandbox) {
    for (const extra of SANDBOX_SKIP_EXTRAS) push(extra.phone, extra.contactName, extra.relationship)
  }
  return rows
    .sort((left, right) => SKIP_CLOSENESS[left.relationship] - SKIP_CLOSENESS[right.relationship])
    .map((row, index) => ({ ...row, rank: index + 1 }))
}

function skipEntries(raw: unknown): Array<{ phone: unknown; contactName: unknown; relationship: SkipRelationship }> {
  if (Array.isArray(raw)) return raw.map(skipEntry)
  if (typeof raw === 'string' && raw.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(raw) as unknown
      if (Array.isArray(parsed)) return parsed.map(skipEntry)
    } catch {
      return []
    }
  }
  if (!raw || typeof raw !== 'object') return []
  const record = raw as Record<string, unknown>
  const nested = record.skipPhones ?? record.skip_phones
  if (nested != null && nested !== '') return skipEntries(nested)
  const extras: Array<{ phone: unknown; contactName: unknown; relationship: SkipRelationship }> = []
  for (let index = 2; index <= 6; index += 1) {
    const phone = record[`skip_phone_${index}`]
    if (phone == null || phone === '') continue
    extras.push({
      phone,
      contactName: record[`skip_contact_${index}`],
      relationship: parseSkipRelationship(record[`skip_relationship_${index}`]),
    })
  }
  return extras
}

function skipEntry(item: unknown): { phone: unknown; contactName: unknown; relationship: SkipRelationship } {
  if (!item || typeof item !== 'object') return { phone: null, contactName: null, relationship: 'other' }
  const entry = item as Record<string, unknown>
  return {
    phone: entry.phone ?? entry.phoneNumber,
    contactName: entry.contactName ?? entry.contact_name ?? entry.name,
    relationship: parseSkipRelationship(entry.relationship),
  }
}

function parseSkipRelationship(raw: unknown): SkipRelationship {
  const value = text(raw)?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
  if (value === 'owner' || value === 'self' || value === 'subject') return 'subject'
  if (value === 'spouse' || value === 'wife' || value === 'husband') return 'spouse'
  if (value === 'child' || value === 'son' || value === 'daughter') return 'child'
  if (value === 'heir' || value === 'beneficiary') return 'heir'
  if ((SKIP_RELATIONSHIPS as readonly string[]).includes(value)) return value as SkipRelationship
  return 'other'
}

export function parseNoticeType(raw: unknown, docType?: unknown): ForeclosureNoticeType | null {
  const direct = text(raw)?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
  if ((FORECLOSURE_NOTICE_TYPES as readonly string[]).includes(direct)) return direct as ForeclosureNoticeType
  const blob = `${direct} ${text(docType)?.toLowerCase() ?? ''}`
  if (/lis[\s_-]*pendens/.test(blob)) return 'lis_pendens'
  if (/\bnod\b|notice of default/.test(blob)) return 'nod'
  if (/sheriff/.test(blob)) return 'sheriff_sale'
  if (/notice of sale|trustee sale|notice_of_sale/.test(blob)) return 'notice_of_sale'
  return null
}

export function parseSaleStatus(raw: unknown, lifecycle?: string | null): SaleStatus {
  const value = text(raw)?.toLowerCase().replace(/[\s-]+/g, '_') ?? ''
  if ((SALE_STATUSES as readonly string[]).includes(value)) return value as SaleStatus
  if (value.includes('postpone') || value.includes('delay')) return 'postponed'
  if (value.includes('cancel')) return 'cancelled'
  if (value.includes('reinstate')) return 'reinstated'
  if (value.includes('sold') || value === 'sale_held') return 'sold'
  if (value.includes('schedul')) return 'scheduled'
  if (lifecycle === 'scheduled_sale' || lifecycle === 'confirmed') return 'scheduled'
  if (lifecycle === 'sold') return 'sold'
  if (lifecycle === 'cancelled') return 'cancelled'
  if (lifecycle === 'reinstated') return 'reinstated'
  return 'unknown'
}

export function parseNoticeTimeline(raw: unknown): NoticeTimelineEvent[] {
  if (!Array.isArray(raw)) return []
  const events: NoticeTimelineEvent[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const event = item as Record<string, unknown>
    if (event.field !== 'attorney' && event.field !== 'sale_date') continue
    const at = text(event.at)
    if (!at) continue
    events.push({ at, field: event.field, from: text(event.from), to: text(event.to) })
  }
  return events.slice(-50)
}

export function appendNoticeFileEvents(
  timeline: NoticeTimelineEvent[],
  previous: { saleDate: string | null; attorneyName: string | null },
  next: { saleDate: string | null; attorneyName: string | null },
  at = new Date().toISOString(),
): NoticeTimelineEvent[] {
  const events = [...timeline]
  const push = (field: NoticeTimelineEvent['field'], from: string | null, to: string | null) => {
    if ((from || null) === (to || null)) return
    events.push({ at, field, from, to })
  }
  push('sale_date', previous.saleDate, next.saleDate)
  push('attorney', previous.attorneyName, next.attorneyName)
  return events.slice(-50)
}

export function describeNoticeEvent(event: NoticeTimelineEvent): string {
  const when = usDate(event.at.slice(0, 10))
  const label = event.field === 'sale_date' ? 'Date of sale' : 'Attorney'
  const show = (value: string | null) => {
    if (!value) return 'empty'
    return event.field === 'sale_date' ? usDate(value) : value
  }
  if (!event.from) return `${when}: ${label} set to ${show(event.to)}`
  return `${when}: ${label} changed from ${show(event.from)} to ${show(event.to)}`
}

export function mergeIngestControls(rows: IngestControl[], counties: readonly string[] = DEFAULT_INGEST_COUNTIES): IngestControl[] {
  const stored = new Map(rows.map((row) => [`${row.county}:${row.noticeType}`, row]))
  return counties.flatMap((county) => FORECLOSURE_NOTICE_TYPES.map((noticeType) => (
    stored.get(`${county}:${noticeType}`) ?? {
      county,
      noticeType,
      paused: false,
      updatedSince: null,
    }
  )))
}

/** Incremental scraper watermark. Advance only after a successful county and notice-type pull. */
export function scrapeUpdatedSince(control: Pick<IngestControl, 'updatedSince'>): string | null {
  return control.updatedSince
}

function usDate(isoDate: string | null): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '—'
  const [year, month, day] = isoDate.slice(0, 10).split('-')
  return `${month}/${day}/${year}`
}

function text(raw: unknown): string | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return String(raw)
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  return value || null
}
