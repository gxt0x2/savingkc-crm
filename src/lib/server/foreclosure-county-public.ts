import { parseForeclosureCsv } from '@/lib/prospecting/foreclosure'

import {
  cleanParty,
  extractPdfText,
  noticeRegistryForeclosureUrls,
  parseJocoSales,
  parseLegalRecordMf,
  parseNoticeRegistryHtml,
  parseSouthlawReport,
  toIsoDate,
  type JocoSale,
  type LegalRecordFiling,
  type NoticeRegistryHit,
  type SouthlawRow,
} from '@/lib/server/foreclosure-county-public-parse'

export {
  extractPdfText,
  noticeRegistryForeclosureUrls,
  parseJocoSales,
  parseLegalRecordMf,
  parseNoticeRegistryHtml,
  parseSouthlawReport,
  pdfItemsToLines,
  toIsoDate,
} from '@/lib/server/foreclosure-county-public-parse'
export type {
  JocoSale,
  LegalRecordFiling,
  NoticeRegistryHit,
  SouthlawRow,
} from '@/lib/server/foreclosure-county-public-parse'


/** Public filing sources used by the Sep 2026 county backfill. Not PropStream. */
export const COUNTY_PUBLIC_URLS = {
  jocoSheriff: 'https://jims.jocosheriff.org/fs/api/ForeclosureSales/GetAllSales',
  legalRecordPdf: 'https://thelegalrecord.net/LR.pdf',
  southlawMoPdf: 'https://www.southlaw.com/report/Sales_Report_MO.pdf',
  southlawKsPdf: 'https://www.southlaw.com/report/Sales_Report_KS.pdf',
  noticeRegistrySitemaps: [
    'https://www.noticeregistry.com/notices-sitemap/missouri/1',
    'https://www.noticeregistry.com/notices-sitemap/missouri/2',
    'https://www.noticeregistry.com/notices-sitemap/missouri/3',
  ],
} as const

/**
 * mopublicnotices.com is the Jackson paper-of-record search, but its ASP.NET
 * postback returns the homepage to headless fetch. A computerUse browser
 * session is required. NoticeRegistry is the File N proxy until that gap closes.
 */
export const MOPUBLICNOTICES_COMPUTER_USE_GAP =
  'mopublicnotices.com Jackson foreclosure search needs a computerUse browser session (ASP.NET postback; headless fetch returns the homepage). NoticeRegistry is the File N proxy. Do not treat it as full Daily Record coverage.'


const CSV_HEADERS = [
  'row_id',
  'county',
  'state',
  'layer',
  'lifecycle_status',
  'source_name',
  'source_url',
  'pull_date',
  'notice_or_filing_date',
  'sale_date',
  'sale_time',
  'sale_location',
  'case_number',
  'doc_type',
  'notice_type',
  'owner_name_raw',
  'plaintiff_lender',
  'trustee_or_firm',
  'situs_raw',
  'city',
  'zip',
  'appraised_or_opening_bid',
  'notes',
  'tax_or_dlt_flag',
] as const

}

type ImportRow = Record<(typeof CSV_HEADERS)[number], string>


export function buildCountyPublicCsv(input: {
  pullDate: string
  southlawJackson: SouthlawRow[]
  southlawJohnson: SouthlawRow[]
  jocoSales: JocoSale[]
  legalRecord: LegalRecordFiling[]
  notices: NoticeRegistryHit[]
}): { csv: string; stats: CountyPublicStats; notes: string[] } {
  const stats: CountyPublicStats = {
    southlawJackson: input.southlawJackson.length,
    southlawJohnson: input.southlawJohnson.length,
    jocoSales: input.jocoSales.length,
    legalRecordMf: input.legalRecord.length,
    noticeRegistryJackson: input.notices.length,
    importable: 0,
    skippedNoSitus: 0,
    skippedNoOwner: 0,
    skippedTax: 0,
  }
  const rows: ImportRow[] = []
  const usedJackson = new Set<string>()
  const usedCases = new Set<string>()

  const jacksonByKey = new Map<string, SouthlawRow>()
  for (const row of input.southlawJackson) {
    jacksonByKey.set(addrKey(row.address, row.zip), row)
  }
  const johnsonByCase = new Map<string, SouthlawRow>()
  for (const row of input.southlawJohnson) {
    if (row.caseNumber) johnsonByCase.set(normalizeCase(row.caseNumber), row)
  }

  for (const notice of input.notices) {
    const key = addrKey(notice.address, notice.zip)
    const sale = notice.zip ? jacksonByKey.get(key) : undefined
    if (sale) usedJackson.add(`${sale.address}|${sale.zip}|${sale.firmFile}`)
    const situs = formatSitus(notice.address, notice.city || sale?.city || '', 'MO', notice.zip || sale?.zip || '')
    if (!situs || !notice.owner) {
      stats.skippedNoSitus += situs ? 0 : 1
      stats.skippedNoOwner += notice.owner ? 0 : 1
      continue
    }
    rows.push(blankRow({
      row_id: `nr-${notice.noticeId || slugId(notice.url)}`,
      county: 'Jackson',
      state: 'MO',
      layer: sale ? 'N+S' : 'N',
      lifecycle_status: sale?.saleDate ? 'Scheduled_Sale' : 'Notice',
      source_name: sale
        ? 'NoticeRegistry + SouthLaw Sales_Report_MO.pdf'
        : 'NoticeRegistry (published notice index)',
      source_url: notice.url,
      pull_date: input.pullDate,
      notice_or_filing_date: notice.published || '',
      sale_date: toIsoDate(sale?.saleDate || '') || '',
      sale_time: sale?.saleTime || '',
      sale_location: sale?.saleLocation || 'Jackson County',
      case_number: sale?.caseNumber || '',
      doc_type: 'Trustee Sale Notice',
      notice_type: 'notice_of_sale',
      owner_name_raw: notice.owner,
      plaintiff_lender: '',
      trustee_or_firm: sale?.firmFile ? `SouthLaw firm_file=${sale.firmFile}` : '',
      situs_raw: situs,
      city: notice.city || sale?.city || '',
      zip: notice.zip || sale?.zip || '',
      appraised_or_opening_bid: sale?.opening || '',
      notes: 'Jackson File N via NoticeRegistry. mopublicnotices computerUse gap. Opening bid is not equity debt. PropStream/MLS not used for ingest.',
      tax_or_dlt_flag: 'N',
    }))
  }

  for (const sale of input.jocoSales) {
    const caseNumber = (sale.CaseNumber || '').trim()
    const owner = cleanParty(sale.DefendantName || '')
    if (!caseNumber || !owner) {
      stats.skippedNoOwner += 1
      continue
    }
    const south = johnsonByCase.get(normalizeCase(caseNumber))
    if (!south) {
      stats.skippedNoSitus += 1
      continue
    }
    usedCases.add(normalizeCase(caseNumber))
    const situs = formatSitus(south.address, south.city, 'KS', south.zip)
    rows.push(blankRow({
      row_id: `joco-${normalizeCase(caseNumber)}`.slice(0, 80),
      county: 'Johnson',
      state: 'KS',
      layer: 'S',
      lifecycle_status: jocoLifecycle(sale.Status),
      source_name: 'JoCo Sheriff GetAllSales + SouthLaw Sales_Report_KS.pdf',
      source_url: COUNTY_PUBLIC_URLS.jocoSheriff,
      pull_date: input.pullDate,
      notice_or_filing_date: toIsoDate(sale.FirstPublicationDate || '') || '',
      sale_date: toIsoDate(sale.SaleDateString || '') || '',
      sale_time: sale.SaleTimeString || south.saleTime,
      sale_location: south.saleLocation || 'Olathe',
      case_number: caseNumber,
      doc_type: 'Sheriff Sale',
      notice_type: 'sheriff_sale',
      owner_name_raw: owner,
      plaintiff_lender: cleanParty(sale.PlaintiffName || ''),
      trustee_or_firm: cleanParty(sale.AttorneyName || ''),
      situs_raw: situs,
      city: south.city,
      zip: south.zip,
      appraised_or_opening_bid: south.opening,
      notes: `status=${sale.Status || ''}; ${sale.SaleHeaderText || ''}; buyer=${sale.BuyerName || ''}; amt=${sale.BuyerAmount || ''}. Firm PDF is not the full market. Equity overlay is later (PropStream optional / MLS comps only).`,
      tax_or_dlt_flag: 'N',
    }))
  }

  for (const filing of input.legalRecord) {
    const key = normalizeCase(filing.caseNumber)
    if (usedCases.has(key)) continue
    const south = johnsonByCase.get(key)
    if (!filing.defendant) {
      stats.skippedNoOwner += 1
      continue
    }
    if (!south) {
      stats.skippedNoSitus += 1
      continue
    }
    usedCases.add(key)
    rows.push(blankRow({
      row_id: `lr-${key}`.slice(0, 80),
      county: 'Johnson',
      state: 'KS',
      layer: 'N+S',
      lifecycle_status: 'Scheduled_Sale',
      source_name: 'The Legal Record LR.pdf + SouthLaw Sales_Report_KS.pdf',
      source_url: COUNTY_PUBLIC_URLS.legalRecordPdf,
      pull_date: input.pullDate,
      notice_or_filing_date: filing.issueDate || '',
      sale_date: toIsoDate(south.saleDate) || '',
      sale_time: south.saleTime,
      sale_location: south.saleLocation || 'Olathe',
      case_number: filing.caseNumber,
      doc_type: 'MF',
      notice_type: 'lis_pendens',
      owner_name_raw: filing.defendant,
      plaintiff_lender: filing.plaintiff,
      trustee_or_firm: south.firmFile ? `SouthLaw firm_file=${south.firmFile}` : '',
      situs_raw: formatSitus(south.address, south.city, 'KS', south.zip),
      city: south.city,
      zip: south.zip,
      appraised_or_opening_bid: south.opening,
      notes: 'Legal Record MF only (TF excluded). Situs from SouthLaw case match. No street on the civil-filing line itself.',
      tax_or_dlt_flag: 'N',
    }))
  }

  for (const sale of input.southlawJackson) {
    const key = `${sale.address}|${sale.zip}|${sale.firmFile}`
    if (usedJackson.has(key)) continue
    stats.skippedNoOwner += 1
  }
  for (const sale of input.southlawJohnson) {
    if (sale.caseNumber && usedCases.has(normalizeCase(sale.caseNumber))) continue
    stats.skippedNoOwner += 1
  }

  stats.importable = rows.length
  const notes = [
    MOPUBLICNOTICES_COMPUTER_USE_GAP,
    `county_public rows=${rows.length}; NR=${stats.noticeRegistryJackson}; SouthLaw Jackson=${stats.southlawJackson}; SouthLaw Johnson=${stats.southlawJohnson}; JoCo=${stats.jocoSales}; LR MF=${stats.legalRecordMf}; skipped_no_situs=${stats.skippedNoSitus}; skipped_no_owner=${stats.skippedNoOwner}.`,
    'PropStream is not an ingest provider. Optional equity later. MLS/Matrix is value and comps only.',
  ]
  return { csv: toCsv(rows), stats, notes }
}

export async function fetchCountyPublicCsv(input?: {
  fetchImpl?: typeof fetch
  now?: Date
  pullDate?: string
  noticeCap?: number
}): Promise<{
  ok: boolean
  csv: string
  stats: CountyPublicStats
  notes: string[]
  errors: string[]
}> {
  const fetchImpl = input?.fetchImpl ?? fetch
  const now = input?.now ?? new Date()
  const pullDate = input?.pullDate || chicagoPullDate(now)
  const noticeCap = input?.noticeCap ?? noticePageCap()
  const errors: string[] = []
  const notes: string[] = [MOPUBLICNOTICES_COMPUTER_USE_GAP]

  const [joco, lrPdf, moPdf, ksPdf, sitemaps] = await Promise.all([
    fetchText(fetchImpl, COUNTY_PUBLIC_URLS.jocoSheriff, 'joco'),
    fetchBytes(fetchImpl, COUNTY_PUBLIC_URLS.legalRecordPdf, 'legal_record'),
    fetchBytes(fetchImpl, COUNTY_PUBLIC_URLS.southlawMoPdf, 'southlaw_mo'),
    fetchBytes(fetchImpl, COUNTY_PUBLIC_URLS.southlawKsPdf, 'southlaw_ks'),
    Promise.all(COUNTY_PUBLIC_URLS.noticeRegistrySitemaps.map((url) => fetchText(fetchImpl, url, 'notice_registry_sitemap'))),
  ])

  let jocoSales: JocoSale[] = []
  if (joco.ok) {
    try {
      jocoSales = parseJocoSales(joco.text)
    } catch (error) {
      errors.push(`joco json: ${messageOf(error)}`)
    }
  } else errors.push(joco.error)

  let southlawJackson: SouthlawRow[] = []
  let southlawJohnson: SouthlawRow[] = []
  if (moPdf.ok) {
    try {
      southlawJackson = parseSouthlawReport(await extractPdfText(moPdf.bytes), 'Jackson')
    } catch (error) {
      errors.push(`southlaw_mo pdf: ${messageOf(error)}`)
    }
  } else errors.push(moPdf.error)
  if (ksPdf.ok) {
    try {
      southlawJohnson = parseSouthlawReport(await extractPdfText(ksPdf.bytes), 'Johnson')
    } catch (error) {
      errors.push(`southlaw_ks pdf: ${messageOf(error)}`)
    }
  } else errors.push(ksPdf.error)

  let legalRecord: LegalRecordFiling[] = []
  if (lrPdf.ok) {
    try {
      const parsed = parseLegalRecordMf(await extractPdfText(lrPdf.bytes))
      legalRecord = parsed.filings
      notes.push(`Legal Record issue ${parsed.issueDate || 'unknown'}; TF cases excluded=${parsed.taxCases}.`)
    } catch (error) {
      errors.push(`legal_record pdf: ${messageOf(error)}`)
    }
  } else errors.push(lrPdf.error)

  const sitemapXml = sitemaps.filter((item) => item.ok).map((item) => item.text).join('\n')
  const sitemapErrors = sitemaps.filter((item) => !item.ok).map((item) => item.error)
  if (!sitemapXml && sitemapErrors.length) errors.push(sitemapErrors[0])
  const noticeUrls = noticeRegistryForeclosureUrls(sitemapXml, now).slice(0, noticeCap)
  const notices: NoticeRegistryHit[] = []
  const queue = [...noticeUrls]
  const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
    while (queue.length) {
      const url = queue.shift()
      if (!url) return
      const page = await fetchText(fetchImpl, url, 'notice_registry')
      if (!page.ok) continue
      const hit = parseNoticeRegistryHtml(page.text, url)
      if (hit) notices.push(hit)
    }
  })
  await Promise.all(workers)
  notes.push(`NoticeRegistry fetched ${noticeUrls.length} foreclosure URL(s); Jackson hits ${notices.length}.`)

  const built = buildCountyPublicCsv({
    pullDate,
    southlawJackson,
    southlawJohnson,
    jocoSales,
    legalRecord,
    notices,
  })
  const hardFailures = [joco, lrPdf, moPdf, ksPdf].filter((item) => !item.ok).length
  const ok = built.stats.importable > 0 || hardFailures < 4
  return {
    ok,
    csv: built.csv,
    stats: built.stats,
    notes: [...notes, ...built.notes, ...errors.map((error) => `source error: ${error}`)],
    errors,
  }
}

function noticePageCap(): number {
  const raw = Number(process.env.FORECLOSURE_NR_PAGE_CAP)
  if (Number.isFinite(raw) && raw >= 5 && raw <= 80) return Math.floor(raw)
  return 36
}

function blankRow(partial: Partial<ImportRow> & Pick<ImportRow, 'row_id' | 'county' | 'state' | 'situs_raw' | 'owner_name_raw'>): ImportRow {
  const row = Object.fromEntries(CSV_HEADERS.map((header) => [header, ''])) as ImportRow
  Object.assign(row, partial)
  return row
}

function toCsv(rows: ImportRow[]): string {
  const lines = [CSV_HEADERS.join(',')]
  for (const row of rows) lines.push(CSV_HEADERS.map((header) => csvCell(row[header] || '')).join(','))
  return `${lines.join('\n')}\n`
}

function csvCell(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}


function normalizeCase(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '')
}

function addrKey(address: string, zip: string): string {
  const number = address.match(/\d+/)?.[0] || ''
  const word = address.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).find((token) => /[a-z]/.test(token)) || ''
  return `${number}|${word}|${zip}`
}


function formatSitus(street: string, city: string, state: string, zip: string): string {
  const cityPart = city ? `, ${city}` : ''
  const zipPart = zip ? ` ${zip}` : ''
  return `${street}${cityPart}, ${state}${zipPart}`.replace(/\s+/g, ' ').trim()
}


function jocoLifecycle(status: string | undefined): string {
  const value = (status || '').toUpperCase()
  if (value.includes('CANCEL')) return 'Cancelled'
  if (value === 'SOLD') return 'Sold'
  return 'Scheduled_Sale'
}

function slugId(url: string): string {
  return url.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(-40) || 'notice'
}

function chicagoPullDate(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(now)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 180) : 'unknown'
}

async function fetchText(fetchImpl: typeof fetch, url: string, label: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'text/html,application/json,application/xml,text/plain,*/*',
        'User-Agent': 'SavingKC-CRM-foreclosure-ingest/1.0 (public county records)',
      },
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, error: `${label} HTTP ${response.status}` }
    const text = await response.text()
    if (!text.trim()) return { ok: false, error: `${label} empty body` }
    return { ok: true, text }
  } catch (error) {
    return { ok: false, error: `${label} ${messageOf(error)}` }
  }
}

async function fetchBytes(fetchImpl: typeof fetch, url: string, label: string): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; error: string }> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/pdf,*/*',
        'User-Agent': 'SavingKC-CRM-foreclosure-ingest/1.0 (public county records)',
      },
      signal: AbortSignal.timeout(25_000),
      cache: 'no-store',
    })
    if (!response.ok) return { ok: false, error: `${label} HTTP ${response.status}` }
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength < 100) return { ok: false, error: `${label} short body` }
    return { ok: true, bytes }
  } catch (error) {
    return { ok: false, error: `${label} ${messageOf(error)}` }
  }
}

export function countyPublicCsvHasRows(csv: string): boolean {
  return parseForeclosureCsv(csv).accepted.length > 0
}
