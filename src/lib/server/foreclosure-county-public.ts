import { parseForeclosureCsv } from '@/lib/prospecting/foreclosure'

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

const METRO_SLUGS = [
  'kansas-city',
  'independence',
  'lees-summit',
  'grandview',
  'blue-springs',
  'raytown',
  'grain-valley',
  'oak-grove',
  'buckner',
  'sugar-creek',
  'lake-lotawana',
  'lone-jack',
  'greenwood',
]

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

export type SouthlawRow = {
  address: string
  city: string
  zip: string
  saleDate: string
  saleTime: string
  opening: string
  saleLocation: string
  caseNumber: string
  firmFile: string
}

export type JocoSale = {
  Status?: string
  SaleDateString?: string
  SaleTimeString?: string
  SaleHeaderText?: string
  CaseNumber?: string
  PlaintiffName?: string
  DefendantName?: string
  AttorneyName?: string
  BuyerName?: string
  BuyerAmount?: string
  FirstPublicationDate?: string
}

export type LegalRecordFiling = {
  caseNumber: string
  plaintiff: string
  defendant: string
  issueDate: string | null
}

export type NoticeRegistryHit = {
  url: string
  noticeId: string
  address: string
  city: string
  zip: string
  owner: string
  published: string | null
}

export type CountyPublicStats = {
  southlawJackson: number
  southlawJohnson: number
  jocoSales: number
  legalRecordMf: number
  noticeRegistryJackson: number
  importable: number
  skippedNoSitus: number
  skippedNoOwner: number
  skippedTax: number
}

type ImportRow = Record<(typeof CSV_HEADERS)[number], string>

export function pdfItemsToLines(items: Array<{ str?: string; transform?: number[] }>): string[] {
  const buckets: Array<{ y: number; parts: Array<{ x: number; str: string }> }> = []
  for (const item of items) {
    const str = item.str?.replace(/\s+/g, ' ').trim()
    const transform = item.transform
    if (!str || !transform || transform.length < 6) continue
    const y = transform[5]
    const x = transform[4]
    let bucket = buckets.find((row) => Math.abs(row.y - y) < 2)
    if (!bucket) {
      bucket = { y, parts: [] }
      buckets.push(bucket)
    }
    bucket.parts.push({ x, str })
  }
  return buckets
    .sort((a, b) => b.y - a.y)
    .map((row) => {
      const parts = [...row.parts].sort((a, b) => a.x - b.x)
      let line = ''
      let lastX = Number.NEGATIVE_INFINITY
      for (const part of parts) {
        const gap = part.x - lastX
        if (line) line += gap > 12 ? ' | ' : ' '
        line += part.str
        lastX = part.x + Math.max(part.str.length * 4, 8)
      }
      return line.trim()
    })
    .filter(Boolean)
}

export async function extractPdfText(bytes: Uint8Array): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const params = {
    data: bytes,
    disableWorker: true,
    isEvalSupported: false,
    verbosity: 0,
  }
  const doc = await pdfjs.getDocument(params as Parameters<typeof pdfjs.getDocument>[0]).promise
  const lines: string[] = []
  for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
    const page = await doc.getPage(pageNumber)
    const content = await page.getTextContent()
    lines.push(...pdfItemsToLines(content.items as Array<{ str?: string; transform?: number[] }>))
  }
  return lines.join('\n')
}

function isCountyHeader(line: string): boolean {
  const value = line.trim()
  if (!/^[A-Za-z][A-Za-z .'-]{1,40}$/.test(value)) return false
  if (/\d/.test(value)) return false
  if (/property|foreclosure|information|reported|page/i.test(value)) return false
  return true
}

export function parseSouthlawReport(text: string, countyName: string): SouthlawRow[] {
  const rows: SouthlawRow[] = []
  const seen = new Set<string>()
  let inCounty = false
  for (const raw of text.split(/\n/)) {
    const line = raw.trim()
    if (!line) continue
    if (isCountyHeader(line)) {
      inCounty = line.toLowerCase() === countyName.toLowerCase()
      continue
    }
    if (!inCounty) continue
    const row = parseSouthlawDataLine(line)
    if (!row) continue
    const key = `${row.address}|${row.zip}|${row.saleDate}|${row.firmFile}|${row.caseNumber}`
    if (seen.has(key)) continue
    seen.add(key)
    rows.push(row)
  }
  return rows
}

function parseSouthlawDataLine(line: string): SouthlawRow | null {
  if (line.includes('|')) {
    const parts = line.split('|').map((part) => part.trim()).filter(Boolean)
    if (parts.length < 5) return null
    const address = parts[0]
    const city = parts[1] || ''
    const zip = (parts[2] || '').slice(0, 5)
    const saleDate = parts[3] || ''
    const saleTime = (parts[4] || '').replace(/\s+/g, '')
    if (!/^\d{5}$/.test(zip) || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(saleDate)) return null
    const openingRaw = parts[6] || ''
    const saleLocation = parts[7] || ''
    const tail = parts.slice(8)
    let caseNumber = ''
    let firmFile = ''
    for (const token of tail) {
      if (/[A-Z]{1,3}-?\d{2,4}-?[A-Z]{2}-?\d{3,}/i.test(token) || /CV/i.test(token)) caseNumber = token.replace(/\s+/g, '')
      if (/^\d{5,6}$/.test(token)) firmFile = token
    }
    return {
      address,
      city,
      zip,
      saleDate,
      saleTime,
      opening: money(openingRaw),
      saleLocation,
      caseNumber,
      firmFile,
    }
  }
  const match = line.match(
    /^(.+?)\s+(\d{5})(?:-\d{4})?\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(\d{1,2}:\d{2}\s*[AP]M)\s+(\S+)\s+(\S+|\$[\d,]+\.\d{2})\s+(.+?)\s+(\d{5,6})\s*$/i,
  )
  if (!match) return null
  const caseToken = match[7].split(/\s+/).find((token) => /CV|^\d{2}CV/i.test(token)) || ''
  const location = match[7].replace(caseToken, '').trim()
  return {
    address: match[1].trim(),
    city: '',
    zip: match[2],
    saleDate: match[3],
    saleTime: match[4].replace(/\s+/g, ''),
    opening: money(match[6]),
    saleLocation: location,
    caseNumber: caseToken.replace(/\s+/g, ''),
    firmFile: match[8],
  }
}

export function parseJocoSales(payload: unknown): JocoSale[] {
  const body = typeof payload === 'string' ? JSON.parse(payload) as unknown : payload
  if (!body || typeof body !== 'object') return []
  const sales = (body as { SalesList?: unknown }).SalesList
  if (!Array.isArray(sales)) return []
  const seen = new Set<string>()
  const rows: JocoSale[] = []
  for (const item of sales) {
    if (!item || typeof item !== 'object') continue
    const sale = item as JocoSale
    const key = `${sale.CaseNumber || ''}|${sale.SaleDateString || ''}|${sale.Status || ''}`
    if (!sale.CaseNumber || seen.has(key)) continue
    seen.add(key)
    rows.push(sale)
  }
  return rows
}

export function parseLegalRecordMf(text: string): { filings: LegalRecordFiling[]; taxCases: number; issueDate: string | null } {
  const issue = text.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+20\d{2}\b/i)
  const issueDate = issue ? toIsoDate(issue[0]) : null
  const tax = new Set<string>()
  for (const line of text.split(/\n/)) {
    if (!/\bTF\b/.test(line)) continue
    const caseNumber = line.match(/JO-20\d{2}-CV-\d{6}/)?.[0]
    if (caseNumber) tax.add(caseNumber)
  }
  const filings: LegalRecordFiling[] = []
  const seen = new Set<string>()
  for (const line of text.split(/\n/)) {
    if (!/\bMF\b/.test(line)) continue
    const caseNumber = line.match(/JO-20\d{2}-CV-\d{6}/)?.[0]
    if (!caseNumber || tax.has(caseNumber) || seen.has(caseNumber)) continue
    seen.add(caseNumber)
    const parties = line.match(/^(.+?)\s+VS\.+\s*(.+?)\s*\.+\s*MF/i)
    filings.push({
      caseNumber,
      plaintiff: cleanParty(parties?.[1] || ''),
      defendant: cleanParty(parties?.[2] || ''),
      issueDate,
    })
  }
  return { filings, taxCases: tax.size, issueDate }
}

export function parseNoticeRegistryHtml(html: string, url: string): NoticeRegistryHit | null {
  const text = html
    .replace(/\\n/g, ' ')
    .replace(/\\t/g, ' ')
    .replace(/\\"/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
  if (!/jackson county/i.test(text)) return null
  if (/\b(tax sale|delinquent tax|certificate of purchase)\b/i.test(text) && !/deed of trust/i.test(text)) return null
  const address = text.match(/"address":"([^"]+)"/)?.[1]?.trim()
    || text.match(/Foreclosure:\s*([^"|<]+)/i)?.[1]?.trim()
    || ''
  if (!/\d/.test(address)) return null
  const owner = text.match(/executed by\s+([^,]{3,140})/i)?.[1]?.trim()
    || text.match(/against\s+([A-Z][^.]{2,80}?)\s+concerning/i)?.[1]?.trim()
    || ''
  if (!owner || /truncated/i.test(owner)) return null
  const publishedRaw = text.match(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},\s+20\d{2}\b/i)?.[0] || ''
  const situs = splitSitus(address.includes(',') ? address : address)
  return {
    url,
    noticeId: url.match(/(\d{5,})/)?.[1] || '',
    address: situs.street || address,
    city: situs.city,
    zip: situs.zip,
    owner: owner.replace(/\s+/g, ' '),
    published: toIsoDate(publishedRaw),
  }
}

export function noticeRegistryForeclosureUrls(sitemapXml: string, now = new Date(), windowDays = 75): string[] {
  const cutoff = now.getTime() - windowDays * 24 * 60 * 60 * 1000
  const blocks = sitemapXml.match(/<url>[\s\S]*?<\/url>/g) || []
  const ranked: Array<{ url: string; lastmod: number; metro: boolean }> = []
  for (const block of blocks) {
    const loc = block.match(/<loc>([^<]+)<\/loc>/)?.[1] || ''
    if (!/\/missouri\/notice\/foreclosure-/i.test(loc)) continue
    const lastmodRaw = block.match(/<lastmod>([^<]+)<\/lastmod>/)?.[1] || ''
    const lastmod = Date.parse(lastmodRaw)
    if (Number.isFinite(lastmod) && lastmod < cutoff) continue
    const metro = METRO_SLUGS.some((slug) => loc.toLowerCase().includes(slug))
    ranked.push({ url: loc.trim(), lastmod: Number.isFinite(lastmod) ? lastmod : 0, metro })
  }
  ranked.sort((a, b) => Number(b.metro) - Number(a.metro) || b.lastmod - a.lastmod)
  const seen = new Set<string>()
  const urls: string[] = []
  for (const row of ranked) {
    if (seen.has(row.url)) continue
    seen.add(row.url)
    urls.push(row.url)
  }
  return urls
}

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

function money(raw: string): string {
  if (!raw || /n\/a/i.test(raw)) return ''
  const match = raw.replace(/[$,]/g, '').match(/\d+(?:\.\d{2})?/)
  return match?.[0] || ''
}

function cleanParty(value: string): string {
  return value.replace(/\.+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 180)
}

function normalizeCase(value: string): string {
  return value.toUpperCase().replace(/\s+/g, '')
}

function addrKey(address: string, zip: string): string {
  const number = address.match(/\d+/)?.[0] || ''
  const word = address.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').trim().split(/\s+/).find((token) => /[a-z]/.test(token)) || ''
  return `${number}|${word}|${zip}`
}

function splitSitus(situs: string): { street: string; city: string; zip: string } {
  const zip = situs.match(/\b(\d{5})(?:-\d{4})?\b/)?.[1] || ''
  const parts = situs.split(',').map((part) => part.trim())
  const street = parts[0] || situs
  let city = parts[1] || ''
  if (/^(mo|ks)\b/i.test(city)) city = ''
  city = city.replace(/\b(MO|KS)\b.*/, '').trim()
  return { street, city, zip }
}

function formatSitus(street: string, city: string, state: string, zip: string): string {
  const cityPart = city ? `, ${city}` : ''
  const zipPart = zip ? ` ${zip}` : ''
  return `${street}${cityPart}, ${state}${zipPart}`.replace(/\s+/g, ' ').trim()
}

export function toIsoDate(raw: string): string | null {
  const value = raw.trim()
  if (!value) return null
  const mdy = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, '0')}-${mdy[2].padStart(2, '0')}`
  const named = value.match(/^(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+(\d{1,2}),\s+(\d{4})$/i)
  if (!named) return null
  const month = named[1].slice(0, 3).toLowerCase()
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  }
  const mm = months[month === 'sept' ? 'sep' : month]
  if (!mm) return null
  return `${named[3]}-${mm}-${named[2].padStart(2, '0')}`
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
