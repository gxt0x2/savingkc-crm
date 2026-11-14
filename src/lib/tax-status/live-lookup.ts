import type { ClayInstallment, PlatteTaxRow } from './balances'
import {
  parseJacksonTaxPortalText,
  parseJohnsonTaxBillHtml,
  parseWyandotteTaxText,
  summarizeClayInstallments,
  summarizePlatteTaxRows,
} from './balances'
import type { CountyLookup } from './gate'
import type { ServiceCounty } from './decision'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const SOURCE: Record<ServiceCounty, string> = {
  jackson: 'jackson_tax_portal',
  johnson: 'johnson_taxbill',
  clay: 'clay_collector',
  platte: 'platte_collector',
  wyandotte: 'wyandotte_tax',
}

function down(county: ServiceCounty): { ok: false; source: string; reason: 'source_down' } {
  return { ok: false, source: SOURCE[county], reason: 'source_down' }
}

async function readText(response: Response): Promise<string | null> {
  if (!response.ok) return null
  try {
    return await response.text()
  } catch {
    return null
  }
}

async function clayBalance(parcelId: string, fetchImpl: FetchLike, now: Date) {
  const today = now
  const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`
  const years = [today.getFullYear() - 1, today.getFullYear() - 2, today.getFullYear() - 3]
  const rows: ClayInstallment[] = []
  for (const year of years) {
    const url = `https://collector.claycountymo.gov/api/installments.php?parcel_number=${encodeURIComponent(parcelId)}&tax_year=${year}&interest_date=${todayStr}`
    try {
      const response = await fetchImpl(url, {
        headers: {
          Referer: 'https://collector.claycountymo.gov/',
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(15000),
      })
      if (!response.ok) return down('clay')
      const json = await response.json() as { success?: boolean; data?: { balance_amount?: unknown; no_charges_due?: boolean } }
      if (!json.success) return down('clay')
      rows.push({
        year,
        ok: true,
        balance: json.data?.balance_amount,
        noChargesDue: json.data?.no_charges_due === true,
      })
    } catch {
      return down('clay')
    }
  }
  return { ok: true as const, source: SOURCE.clay, balance: summarizeClayInstallments(rows, now) }
}

async function johnsonBalance(parcelId: string, fetchImpl: FetchLike, now: Date) {
  const year = now.getFullYear() - 1
  const url = `https://taxbill.jocogov.org/Property-Detail?PropertyQuickRefID=${encodeURIComponent(parcelId)}&TaxYear=${year}`
  try {
    const response = await fetchImpl(url, {
      headers: { Referer: 'https://taxbill.jocogov.org/' },
      signal: AbortSignal.timeout(12000),
    })
    const html = await readText(response)
    if (!html || !/Total Due|Past Years Due/i.test(html)) return down('johnson')
    return { ok: true as const, source: SOURCE.johnson, balance: parseJohnsonTaxBillHtml(html) }
  } catch {
    return down('johnson')
  }
}

async function jacksonBalance(parcelId: string, fetchImpl: FetchLike, now: Date) {
  const scraperApiKey = process.env.SCRAPER_API_KEY
  if (!scraperApiKey) return down('jackson')
  const accountUrl = `https://mo-jackson.publicaccessnow.com/Collector/TaxSearch.aspx?parcel=${encodeURIComponent(parcelId)}`
  const scraperUrl = `https://api.scraperapi.com?api_key=${encodeURIComponent(scraperApiKey)}&url=${encodeURIComponent(accountUrl)}&render=true&country_code=us&wait=4000`
  try {
    const response = await fetchImpl(scraperUrl, { signal: AbortSignal.timeout(20000) })
    const text = await readText(response)
    if (!text || (!text.includes('Total Due') && !text.includes('Tax Bills'))) return down('jackson')
    const parsed = parseJacksonTaxPortalText(text, now)
    return { ok: true as const, source: SOURCE.jackson, balance: parsed }
  } catch {
    return down('jackson')
  }
}

function platteRowsFromHtml(html: string): PlatteTaxRow[] {
  const rows: PlatteTaxRow[] = []
  const pattern = /<tr[\s\S]*?<\/tr>/gi
  for (const chunk of html.match(pattern) ?? []) {
    const cells = [...chunk.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      match[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim(),
    )
    if (cells.length < 5) continue
    const year = Number.parseInt(cells[0] ?? '', 10)
    const amount = Number.parseFloat((cells[2] ?? '').replace(/[$,\s]/g, ''))
    if (!Number.isFinite(year) || !Number.isFinite(amount)) continue
    const datePaid = cells[4] ?? ''
    rows.push({
      year,
      amount,
      paid: datePaid.length > 3 && !/unpaid|past due/i.test(datePaid),
      redeemed: /redeemed/i.test(chunk),
    })
  }
  return rows
}

async function platteBalance(parcelId: string, fetchImpl: FetchLike, now: Date) {
  const url = `https://plattecountycollector.com/realview.php?user=beacon&pid=${encodeURIComponent(parcelId)}`
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) })
    const html = await readText(response)
    if (!html) return down('platte')
    const rows = platteRowsFromHtml(html)
    if (rows.length === 0) return down('platte')
    return { ok: true as const, source: SOURCE.platte, balance: summarizePlatteTaxRows(rows, now) }
  } catch {
    return down('platte')
  }
}

async function wyandotteBalance(parcelId: string, fetchImpl: FetchLike, now: Date) {
  const url = `https://appr.wycokck.org/Property-Detail/PropertyQuickRefID/${encodeURIComponent(parcelId)}/`
  try {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) })
    const text = await readText(response)
    if (!text) return down('wyandotte')
    const parsed = parseWyandotteTaxText(text, now)
    if (!parsed) return down('wyandotte')
    return { ok: true as const, source: SOURCE.wyandotte, balance: parsed }
  } catch {
    return down('wyandotte')
  }
}

/** Live balance by county. Reuses the collector URLs and numeric Clay parser. A failure stays unverified. */
export function createLiveBalanceLookup(fetchImpl: FetchLike = fetch, now = new Date()): CountyLookup {
  return async ({ county, parcelId }) => {
    if (county === 'jackson') return jacksonBalance(parcelId, fetchImpl, now)
    if (county === 'johnson') return johnsonBalance(parcelId, fetchImpl, now)
    if (county === 'clay') return clayBalance(parcelId, fetchImpl, now)
    if (county === 'platte') return platteBalance(parcelId, fetchImpl, now)
    if (county === 'wyandotte') return wyandotteBalance(parcelId, fetchImpl, now)
    return { ok: false, source: 'unsupported_county', reason: 'source_down' }
  }
}
