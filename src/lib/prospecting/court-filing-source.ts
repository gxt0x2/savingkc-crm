import { parseForeclosureCsv } from '@/lib/prospecting/foreclosure'
import { gapsForLane, type CoverageCell } from '@/lib/prospecting/court-filing-coverage'

/** Official public entry points. Probes are one GET and stop on a block. They are not scheduled. */
export const PUBLIC_FILING_SOURCES = {
  casenet: 'https://www.courts.mo.gov/casenet/welcome.do',
  kansasCaseSearch: 'https://casesearch.kscourts.gov/',
  jacksonRecorder: 'https://aumentumweb.jacksongov.org/RealEstate/SearchEntry.aspx',
} as const

export type PublicFilingSource = keyof typeof PUBLIC_FILING_SOURCES

export type FilingLane = 'divorce' | 'lien'

export type FilingLaneRow = {
  id: string
  county: string
  state: string
  kind: string
  partyName: string
  situs: string | null
  caseNumber: string | null
  filedOn: string | null
  sourceName: string | null
  dialerEnrolled: false
}

export type FilingLaneView = {
  lane: FilingLane
  rows: FilingLaneRow[]
  gaps: CoverageCell[]
  dialerEnrolled: false
  outOfScope: string
}

const OUT_OF_SCOPE = 'Clay, Wyandotte, Platte, and Cass are not in this pass.'

export function classifyPublicFilingResponse(source: PublicFilingSource, status: number, body: string): { rows: []; blocked: true; reason: string } {
  const text = body.toLowerCase()
  if (source === 'casenet' && (status === 403 || (text.includes('expressly prohibited') && text.includes('scraper')))) {
    return { rows: [], blocked: true, reason: 'Case.net prohibits automated scraping and did not return case rows.' }
  }
  if (source === 'kansasCaseSearch') {
    if (status === 403 || text.includes('you have been blocked') || (text.includes('cloudflare') && text.includes('attention required'))) {
      return { rows: [], blocked: true, reason: 'Kansas Case Search blocked this client and did not return case rows.' }
    }
  }
  if (source === 'jacksonRecorder' && (text.includes('loginform1_txtpassword') || (text.includes('browser test') && text.includes('password')))) {
    return { rows: [], blocked: true, reason: 'Jackson recorder public search returned a login form and did not return lien rows.' }
  }
  return { rows: [], blocked: true, reason: 'The response was not a stable unauthenticated result document, so no rows were stored.' }
}

export async function probePublicFilingSource(source: PublicFilingSource, fetchImpl: typeof fetch = fetch): Promise<{ source: PublicFilingSource; rows: []; blocked: true; reason: string }> {
  try {
    const response = await fetchImpl(PUBLIC_FILING_SOURCES[source], {
      headers: {
        Accept: 'text/html',
        'User-Agent': 'SavingKC-CRM-filing-probe/1.0 (public records; fail closed)',
      },
      signal: AbortSignal.timeout(20_000),
      cache: 'no-store',
      redirect: 'follow',
    })
    const body = await response.text()
    const classified = classifyPublicFilingResponse(source, response.status, body)
    return { source, ...classified }
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 160) : 'request failed'
    return { source, rows: [], blocked: true, reason: `Public filing probe failed closed (${message}).` }
  }
}

type RawFilingRow = {
  id?: unknown
  county?: unknown
  state?: unknown
  filing_kind?: unknown
  lien_kind?: unknown
  party_name?: unknown
  debtor_name?: unknown
  situs?: unknown
  case_number?: unknown
  instrument_number?: unknown
  filed_on?: unknown
  recorded_on?: unknown
  source_name?: unknown
  dialer_enrolled?: unknown
}

export function presentFilingLane(lane: FilingLane, rawRows: RawFilingRow[] | null, unavailable = false): FilingLaneView {
  const rows: FilingLaneRow[] = []
  for (const raw of rawRows ?? []) {
    if (raw.dialer_enrolled === true) continue
    const county = text(raw.county)
    if (county !== 'jackson' && county !== 'johnson') continue
    const partyName = text(raw.party_name) || text(raw.debtor_name)
    if (!partyName) continue
    const id = text(raw.id)
    if (!id) continue
    rows.push({
      id,
      county,
      state: text(raw.state) || (county === 'johnson' ? 'KS' : 'MO'),
      kind: text(raw.filing_kind) || text(raw.lien_kind) || lane,
      partyName,
      situs: text(raw.situs),
      caseNumber: text(raw.case_number) || text(raw.instrument_number),
      filedOn: text(raw.filed_on) || text(raw.recorded_on),
      sourceName: text(raw.source_name),
      dialerEnrolled: false,
    })
  }
  return {
    lane,
    rows: unavailable ? [] : rows,
    gaps: gapsForLane(lane),
    dialerEnrolled: false,
    outOfScope: OUT_OF_SCOPE,
  }
}

export type CourtRecordKind = 'divorce' | 'probate' | 'lis_pendens' | 'judicial_foreclosure' | 'federal_tax_lien' | 'hoa_lien'

export type CourtRecordInput = {
  county: string
  state: string
  kind: CourtRecordKind
  partyName: string | null
  situs: string | null
  caseNumber: string | null
  filedOn: string | null
  sourceName: string
  sourceUrl: string
}

export type RoutedCourtRecord =
  | { destination: 'foreclosure_csv'; csv: string; dialerEnrolled: false }
  | { destination: 'court_filing'; dialerEnrolled: false; row: { county: string; state: string; filingKind: 'divorce' | 'lis_pendens' | 'judicial_foreclosure'; partyName: string; situs: string | null; caseNumber: string | null; filedOn: string | null; sourceName: string; sourceUrl: string } }
  | { destination: 'recorder_lien'; dialerEnrolled: false; row: { county: string; state: string; lienKind: 'federal_tax_lien' | 'hoa_lien'; debtorName: string; situs: string | null; instrumentNumber: string | null; recordedOn: string | null; sourceName: string; sourceUrl: string } }
  | { destination: 'existing_inheritance_list'; write: false; dialerEnrolled: false }
  | { destination: 'rejected'; reason: string; dialerEnrolled: false }

export function routeCourtRecord(input: CourtRecordInput): RoutedCourtRecord {
  const county = input.county.trim().toLowerCase()
  if (county !== 'jackson' && county !== 'johnson') {
    return { destination: 'rejected', reason: 'Only Jackson and Johnson are in this pass.', dialerEnrolled: false }
  }
  const state = county === 'johnson' ? 'KS' : 'MO'
  const party = input.partyName?.trim() || ''
  const situs = input.situs?.trim() || ''
  if (input.kind === 'probate') {
    return { destination: 'existing_inheritance_list', write: false, dialerEnrolled: false }
  }
  if (input.kind === 'federal_tax_lien' || input.kind === 'hoa_lien') {
    if (!party) return { destination: 'rejected', reason: 'A lien needs a debtor name.', dialerEnrolled: false }
    return {
      destination: 'recorder_lien',
      dialerEnrolled: false,
      row: {
        county,
        state,
        lienKind: input.kind,
        debtorName: party,
        situs: situs || null,
        instrumentNumber: input.caseNumber,
        recordedOn: input.filedOn,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl,
      },
    }
  }
  if (input.kind === 'divorce') {
    if (!party) return { destination: 'rejected', reason: 'A divorce filing needs a party name.', dialerEnrolled: false }
    return {
      destination: 'court_filing',
      dialerEnrolled: false,
      row: {
        county,
        state,
        filingKind: 'divorce',
        partyName: party,
        situs: situs || null,
        caseNumber: input.caseNumber,
        filedOn: input.filedOn,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl,
      },
    }
  }
  if (!party || !situs) {
    if (!party) return { destination: 'rejected', reason: 'A foreclosure filing needs an owner name.', dialerEnrolled: false }
    return {
      destination: 'court_filing',
      dialerEnrolled: false,
      row: {
        county,
        state,
        filingKind: input.kind,
        partyName: party,
        situs: null,
        caseNumber: input.caseNumber,
        filedOn: input.filedOn,
        sourceName: input.sourceName,
        sourceUrl: input.sourceUrl,
      },
    }
  }
  return { destination: 'foreclosure_csv', csv: foreclosureCsv(input, county, state, party, situs), dialerEnrolled: false }
}

function foreclosureCsv(input: CourtRecordInput, county: string, state: string, party: string, situs: string): string {
  const noticeType = 'lis_pendens'
  const docType = input.kind === 'judicial_foreclosure' ? 'Judicial Foreclosure' : 'Lis Pendens'
  const headers = ['county', 'state', 'owner_name_raw', 'situs_raw', 'notice_type', 'doc_type', 'case_number', 'source_name', 'source_url', 'tax_or_dlt_flag', 'notes']
  const notes = 'Court second layer. Not a trustee notice replacement. No skip trace. No dialer enrollment from the divorce or lien lanes.'
  const cells = [county, state, party, situs, noticeType, docType, input.caseNumber || '', input.sourceName, input.sourceUrl, 'N', notes]
  return `${headers.join(',')}\n${cells.map(csvCell).join(',')}\n`
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function foreclosureCsvAccepted(csv: string) {
  return parseForeclosureCsv(csv)
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}
