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
