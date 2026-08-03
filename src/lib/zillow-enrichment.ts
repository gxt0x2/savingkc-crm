import { fetchRenderedPage, scriptById, scriptContents } from '@/lib/rendered-page'

export interface ZillowInput {
  address: string
  city: string
  state: string
  zip?: string
}

export interface ZillowResult {
  success: boolean
  lotSizeSqft?: number
  lotSizeAcres?: number
  lastSaleDate?: string
  lastSalePrice?: number
  taxAssessment?: number
  yearBuilt?: number
  zestimate?: number
  rentZestimate?: number
  priceHistory?: Array<{
    date: string
    price: number
    event: string
  }>
  taxHistory?: Array<{
    year: number
    amount: number
  }>
  source: 'zillow'
  fetchedAt: string
  error?: string
  rawData?: unknown
}

function positiveNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value.replace(/[$,]/g, ''))
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return undefined
}

function dateValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
    const millis = value > 10_000_000_000 ? value : value * 1000
    return new Date(millis).toISOString().slice(0, 10)
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = Date.parse(value)
    return Number.isNaN(parsed) ? value.trim() : new Date(parsed).toISOString().slice(0, 10)
  }
  return undefined
}

/** Zillow moves homeInfo between page variants, so locate it by its fields. */
export function findZillowHomeInfo(root: unknown): Record<string, unknown> | null {
  const seen = new WeakSet<object>()
  const queue: unknown[] = [root]
  while (queue.length) {
    const node = queue.shift()
    if (!node || typeof node !== 'object') continue
    if (seen.has(node as object)) continue
    seen.add(node as object)
    const record = node as Record<string, unknown>
    if (
      typeof record.zestimate === 'number'
      || (record.zpid != null && typeof record.yearBuilt === 'number')
    ) {
      return record
    }
    queue.push(...Object.values(record))
  }
  return null
}

function parseJsonScript(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function findHomeInfoInHtml(html: string): Record<string, unknown> | null {
  const nextData = scriptById(html, '__NEXT_DATA__')
  if (nextData) {
    const home = findZillowHomeInfo(parseJsonScript(nextData))
    if (home) return home
  }

  for (const script of scriptContents(html)) {
    if (!/zestimate|yearBuilt|taxAssessedValue/.test(script)) continue
    const home = findZillowHomeInfo(parseJsonScript(script))
    if (home) return home
  }
  return null
}

function mapPriceHistory(value: unknown): ZillowResult['priceHistory'] {
  if (!Array.isArray(value)) return undefined
  const rows = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const price = positiveNumber(record.price)
    const date = dateValue(record.date)
    if (!price || !date) return []
    return [{ date, price, event: String(record.event || record.eventName || 'Sale') }]
  })
  return rows.length ? rows : undefined
}

function mapTaxHistory(value: unknown): ZillowResult['taxHistory'] {
  if (!Array.isArray(value)) return undefined
  const rows = value.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const year = positiveNumber(record.time || record.year)
    const amount = positiveNumber(record.taxPaid || record.value || record.taxAmount)
    if (!year || !amount) return []
    return [{ year: Math.trunc(year), amount }]
  })
  return rows.length ? rows : undefined
}

function regexNumber(html: string, key: string): number | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return positiveNumber(html.match(new RegExp(`"${escaped}"\\s*:\\s*"?([\\d,.]+)`, 'i'))?.[1])
}

export function parseZillowHtml(html: string): ZillowResult {
  const home = findHomeInfoInHtml(html)
  const result: ZillowResult = {
    success: true,
    source: 'zillow',
    fetchedAt: new Date().toISOString(),
  }

  if (home) {
    result.zestimate = positiveNumber(home.zestimate)
    result.rentZestimate = positiveNumber(home.rentZestimate)
    result.yearBuilt = positiveNumber(home.yearBuilt)
    result.taxAssessment = positiveNumber(home.taxAssessedValue)
    result.lastSaleDate = dateValue(home.dateSold || home.lastSoldDate)
    result.lastSalePrice = positiveNumber(home.lastSoldPrice || home.price)
    result.priceHistory = mapPriceHistory(home.priceHistory)
    result.taxHistory = mapTaxHistory(home.taxHistory)

    const lotValue = positiveNumber(home.lotAreaValue || home.lotSize)
    const lotUnit = String(home.lotAreaUnit || '').toLowerCase()
    if (lotValue) {
      if (lotUnit.includes('acre')) {
        result.lotSizeAcres = lotValue
        result.lotSizeSqft = Math.round(lotValue * 43_560)
      } else {
        result.lotSizeSqft = Math.round(lotValue)
        result.lotSizeAcres = lotValue / 43_560
      }
    }
  }

  result.zestimate ||= regexNumber(html, 'zestimate')
  result.rentZestimate ||= regexNumber(html, 'rentZestimate')
  result.yearBuilt ||= regexNumber(html, 'yearBuilt')
  result.taxAssessment ||= regexNumber(html, 'taxAssessedValue')
  result.lastSalePrice ||= regexNumber(html, 'lastSoldPrice')
  result.lotSizeSqft ||= regexNumber(html, 'lotAreaValue')
  if (result.lotSizeSqft && !result.lotSizeAcres) {
    result.lotSizeAcres = result.lotSizeSqft / 43_560
  }

  const hasPropertyData = Boolean(
    result.zestimate
    || result.yearBuilt
    || result.taxAssessment
    || result.lotSizeSqft
    || result.lastSalePrice,
  )
  if (!hasPropertyData) {
    return {
      ...result,
      success: false,
      error: 'Could not extract Zillow property data',
    }
  }
  return result
}

function zillowSearchUrl(input: ZillowInput): string {
  const hasFullAddress = /,.*[A-Z]{2}\s*\d{5}/.test(input.address)
  const fullAddress = hasFullAddress
    ? input.address
    : `${input.address}, ${input.city}, ${input.state}${input.zip ? ` ${input.zip}` : ''}`
  return `https://www.zillow.com/homes/${encodeURIComponent(fullAddress).replace(/%20/g, '-')}_rb/`
}

export async function enrichFromZillow(input: ZillowInput): Promise<ZillowResult> {
  try {
    const { html } = await fetchRenderedPage(zillowSearchUrl(input), {
      timeoutMs: 55_000,
      waitMs: 3500,
    })
    return parseZillowHtml(html)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Zillow enrichment failed'
    console.error('[Zillow] Enrichment failed:', message)
    return {
      success: false,
      source: 'zillow',
      fetchedAt: new Date().toISOString(),
      error: message,
    }
  }
}
