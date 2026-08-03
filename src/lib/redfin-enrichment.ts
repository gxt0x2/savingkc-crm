import { fetchRenderedPage, scriptContents } from '@/lib/rendered-page'

export interface RedfinInput {
  address: string
  city: string
  state: string
  zip?: string
}

export interface RedfinResult {
  success: boolean
  redfinEstimate?: number
  lastSaleDate?: string
  lastSalePrice?: number
  yearBuilt?: number
  source: 'redfin'
  fetchedAt: string
  error?: string
  url?: string
}

function numberFromMatch(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number(value.replace(/[$,]/g, ''))
  return Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : undefined
}

function plainText(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&dollar;|&#36;/gi, '$')
    .replace(/\s+/g, ' ')
}

export function parseRedfinHtml(html: string, url?: string): RedfinResult {
  const result: RedfinResult = {
    success: true,
    source: 'redfin',
    fetchedAt: new Date().toISOString(),
    url,
  }

  const candidates = [...scriptContents(html), html]
  for (const candidate of candidates) {
    if (!result.redfinEstimate) {
      result.redfinEstimate = numberFromMatch(
        candidate.match(/"redfinEstimate"\s*:\s*\{[^}]*"estimate"\s*:\s*(\d+)/)?.[1]
          || candidate.match(/"redfinEstimate"\s*:\s*(\d+)/)?.[1]
          || candidate.match(/"estimate"\s*:\s*(\d{4,})/)?.[1],
      )
    }
    if (!result.yearBuilt) {
      result.yearBuilt = numberFromMatch(candidate.match(/"yearBuilt"\s*:\s*(\d{4})/)?.[1])
    }
    if (!result.lastSalePrice) {
      result.lastSalePrice = numberFromMatch(candidate.match(/"lastSoldPrice"\s*:\s*(\d+)/)?.[1])
    }
    if (!result.lastSaleDate) {
      result.lastSaleDate = candidate.match(/"lastSoldDate"\s*:\s*"?(\d{4}-\d{2}-\d{2})"?/)?.[1]
    }
  }

  if (!result.redfinEstimate) {
    const text = plainText(html)
    result.redfinEstimate = numberFromMatch(
      text.match(/Redfin Estimate[^$]{0,120}\$([\d,]+)/i)?.[1],
    )
  }

  if (!result.redfinEstimate) {
    return {
      ...result,
      success: false,
      error: 'Could not extract Redfin estimate',
    }
  }

  return result
}

function findRedfinPath(value: unknown): string | null {
  const queue: unknown[] = [value]
  const seen = new WeakSet<object>()

  while (queue.length) {
    const item = queue.shift()
    if (typeof item === 'string') {
      if (/^https:\/\/www\.redfin\.com\/.+\/home\//i.test(item)) return item
      if (/^\/.+\/home\//i.test(item)) return `https://www.redfin.com${item}`
      continue
    }
    if (!item || typeof item !== 'object') continue
    if (seen.has(item as object)) continue
    seen.add(item as object)
    queue.push(...Object.values(item as Record<string, unknown>))
  }

  return null
}

export function parseRedfinAutocomplete(body: string): string | null {
  const payload = body.includes('&&') ? body.slice(body.indexOf('&&') + 2) : body
  const startCandidates = [payload.indexOf('{'), payload.indexOf('[')].filter((index) => index >= 0)
  const start = startCandidates.length ? Math.min(...startCandidates) : -1
  if (start < 0) return null

  try {
    return findRedfinPath(JSON.parse(payload.slice(start)))
  } catch {
    return null
  }
}

async function resolveRedfinUrl(input: RedfinInput): Promise<string> {
  const fullAddress = `${input.address}, ${input.city}, ${input.state}${input.zip ? ` ${input.zip}` : ''}`
  const autocompleteUrl = new URL('https://www.redfin.com/stingray/do/location-autocomplete')
  autocompleteUrl.searchParams.set('location', fullAddress)
  autocompleteUrl.searchParams.set('v', '2')

  const { html } = await fetchRenderedPage(autocompleteUrl.toString(), {
    render: false,
    timeoutMs: 20_000,
  })
  const propertyUrl = parseRedfinAutocomplete(html)
  if (!propertyUrl) throw new Error('Redfin could not resolve this property address')
  return propertyUrl
}

export async function enrichFromRedfin(input: RedfinInput): Promise<RedfinResult> {
  try {
    const propertyUrl = await resolveRedfinUrl(input)
    const { html } = await fetchRenderedPage(propertyUrl, { timeoutMs: 50_000, waitMs: 2500 })
    return parseRedfinHtml(html, propertyUrl)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Redfin enrichment failed'
    console.error('[Redfin] Enrichment failed:', message)
    return {
      success: false,
      source: 'redfin',
      fetchedAt: new Date().toISOString(),
      error: message,
    }
  }
}
