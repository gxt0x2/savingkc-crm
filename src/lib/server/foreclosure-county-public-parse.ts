/** Parsers for the county_public foreclosure notice pull. Split from foreclosure-county-public.ts to stay under the hygiene line cap. Behavior is unchanged. */

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

function money(raw: string): string {
  if (!raw || /n\/a/i.test(raw)) return ''
  const match = raw.replace(/[$,]/g, '').match(/\d+(?:\.\d{2})?/)
  return match?.[0] || ''
}

export function cleanParty(value: string): string {
  return value.replace(/\.+/g, ' ').replace(/\s+/g, ' ').replace(/^[\s.]+|[\s.]+$/g, '').slice(0, 180)
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

