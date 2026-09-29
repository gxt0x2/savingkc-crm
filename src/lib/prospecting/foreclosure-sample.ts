import { saleWithinWeek, type ForeclosureStatus } from '@/lib/prospecting/foreclosure'
import type { SkipPhone } from '@/lib/prospecting/foreclosure-notice'

/** Stable id so the preview URL stays put even when the row is not in the database. */
export const FORECLOSURE_SAMPLE_ID = 'f7220000-0000-4000-8000-000000000001'
export const FORECLOSURE_SAMPLE_EXTERNAL_ID = 'sample-homeowner-demo'

const SAMPLE_PHONES: SkipPhone[] = [
  { phone: '+18165550101', contactName: 'Sample Homeowner', relationship: 'subject', rank: 1, line: 'mobile' },
  { phone: '+18165550198', contactName: 'Sample Homeowner', relationship: 'subject', rank: 2, line: 'landline' },
]

export interface ForeclosureSampleProspect {
  id: string
  externalRowId: string
  ownerName: string
  ownerEntity: 'person'
  situs: string
  city: string
  state: string
  zip: string
  county: string
  saleDate: string
  noticeOrFilingDate: string
  noticesSent: number
  outreachCount: number
  caseNumber: string
  status: ForeclosureStatus
  noticeLifecycle: string
  saleTime: null
  saleLocation: null
  sourceName: string
  sourceUrl: null
  plaintiffLender: string
  trusteeOrFirm: null
  estValue: number
  estValueSource: string
  estDebt: number
  estDebtSource: string
  estEquity: number
  equityBand: 'strong_100k+'
  priority: boolean
  preferable: boolean
  phones: string[]
  noticeNumber: number
  skipPhones: SkipPhone[]
  latitude: null
  longitude: null
  email: null
  deceased: false
  skiptraceVendor: 'smartskip'
  skiptraceDate: null
  dialReady: false
  dialBlockers: string[]
  prospectId: null
  leadId: null
  notes: string
  skiptraceNotes: string
  mailingAddress: null
  absentee: false
  legalDescription: null
  attorneyName: null
  saleStatus: 'scheduled'
  noticeType: 'notice_of_sale'
  noticeTimeline: []
  ltv: number
  demo: true
}

/**
 * One fictional homeowner for UI review. Phones are 816-555 numbers.
 * Preview responses include this row. It is not written unless the seed script runs.
 */
export function foreclosureSampleProspect(): ForeclosureSampleProspect {
  return {
    id: FORECLOSURE_SAMPLE_ID,
    externalRowId: FORECLOSURE_SAMPLE_EXTERNAL_ID,
    ownerName: 'Sample Homeowner',
    ownerEntity: 'person',
    situs: '418 Sample Lane',
    city: 'Kansas City',
    state: 'MO',
    zip: '64108',
    county: 'jackson',
    saleDate: '2026-11-12',
    noticeOrFilingDate: '2026-09-01',
    noticesSent: 1,
    outreachCount: 1,
    caseNumber: 'SAMPLE-FC-001',
    status: 'new',
    noticeLifecycle: 'scheduled_sale',
    saleTime: null,
    saleLocation: null,
    sourceName: 'Sample demo contact',
    sourceUrl: null,
    plaintiffLender: 'Sample Lender',
    trusteeOrFirm: null,
    estValue: 240000,
    estValueSource: 'manual',
    estDebt: 90000,
    estDebtSource: 'manual',
    estEquity: 150000,
    equityBand: 'strong_100k+',
    priority: true,
    preferable: true,
    phones: SAMPLE_PHONES.map((row) => row.phone),
    noticeNumber: 1,
    skipPhones: SAMPLE_PHONES.map((row) => ({ ...row })),
    latitude: null,
    longitude: null,
    email: null,
    deceased: false,
    skiptraceVendor: 'smartskip',
    skiptraceDate: null,
    dialReady: false,
    dialBlockers: ['Sample demo contact. These phones are not for live dialing.'],
    prospectId: null,
    leadId: null,
    notes: 'Sample demo contact for UI review. Phones are fictional 816-555 numbers.',
    skiptraceNotes: 'Sample demo phones for UI review. Not a live skiptrace.',
    mailingAddress: null,
    absentee: false,
    legalDescription: null,
    attorneyName: null,
    saleStatus: 'scheduled',
    noticeType: 'notice_of_sale',
    noticeTimeline: [],
    ltv: 38,
    demo: true,
  }
}

/** Preview and local dev show the sample. Production does not. */
export function foreclosureSampleContactEnabled(): boolean {
  if (process.env.VERCEL_ENV === 'production') return false
  if (process.env.VERCEL_ENV === 'preview') return true
  return process.env.NODE_ENV === 'development'
}

export function foreclosureSampleById(id: string): ForeclosureSampleProspect | null {
  if (!foreclosureSampleContactEnabled()) return null
  if (id !== FORECLOSURE_SAMPLE_ID) return null
  return foreclosureSampleProspect()
}

export function mergeForeclosureSample<T extends { id: string; externalRowId?: string | null }>(
  prospects: T[],
  filters: { county?: string | null; status?: string | null; dialReady?: boolean; saleThisWeek?: boolean },
  today: string,
): T[] {
  if (!foreclosureSampleContactEnabled()) return prospects
  if (prospects.some((row) => row.id === FORECLOSURE_SAMPLE_ID || row.externalRowId === FORECLOSURE_SAMPLE_EXTERNAL_ID)) {
    return prospects
  }
  const sample = foreclosureSampleProspect()
  if (filters.county && filters.county !== sample.county) return prospects
  if (filters.status && filters.status !== sample.status) return prospects
  if (filters.dialReady && !sample.dialReady) return prospects
  if (filters.saleThisWeek && !saleWithinWeek(sample.saleDate, today)) return prospects
  return [sample as unknown as T, ...prospects]
}

/** Columns for mortgage_foreclosure_prospects. Used by the optional seed script. */
export function foreclosureSampleDatabaseRow() {
  const sample = foreclosureSampleProspect()
  return {
    id: sample.id,
    external_row_id: sample.externalRowId,
    county: sample.county,
    state: sample.state,
    status: sample.status,
    notice_lifecycle: sample.noticeLifecycle,
    source_name: sample.sourceName,
    owner_name: sample.ownerName,
    owner_entity: sample.ownerEntity,
    plaintiff_lender: sample.plaintiffLender,
    situs: sample.situs,
    city: sample.city,
    zip: sample.zip,
    sale_date: sample.saleDate,
    notice_or_filing_date: sample.noticeOrFilingDate,
    case_number: sample.caseNumber,
    est_value: sample.estValue,
    est_value_source: sample.estValueSource,
    est_debt: sample.estDebt,
    est_debt_source: sample.estDebtSource,
    est_equity: sample.estEquity,
    equity_band: sample.equityBand,
    preferable: sample.preferable,
    skiptrace_vendor: sample.skiptraceVendor,
    phone_1: sample.phones[0],
    phone_2: sample.phones[1],
    phone_3: null,
    deceased_flag: false,
    skiptrace_notes: sample.skiptraceNotes,
    notes: sample.notes,
    notice_number: sample.noticeNumber,
    skip_phones: sample.skipPhones,
    tax_or_dlt_flag: false,
    created_by: 'sample-demo',
    updated_by: 'sample-demo',
  }
}
