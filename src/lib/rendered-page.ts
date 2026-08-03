const DEFAULT_TIMEOUT_MS = 50_000

type RenderedPage = {
  html: string
  requestedUrl: string
}

type RenderedPageOptions = {
  render?: boolean
  timeoutMs?: number
  waitMs?: number
}

function scraperApiUrl(
  targetUrl: string,
  apiKey: string,
  options: RenderedPageOptions,
): string {
  const url = new URL('https://api.scraperapi.com')
  url.searchParams.set('api_key', apiKey)
  url.searchParams.set('url', targetUrl)
  url.searchParams.set('render', options.render === false ? 'false' : 'true')
  url.searchParams.set('country_code', 'us')
  if (options.render !== false) {
    url.searchParams.set('wait', String(options.waitMs ?? 3000))
  }
  return url.toString()
}

/**
 * Fetch a JavaScript-rendered public page without requiring a browser binary in
 * the serverless function. Production uses the existing ScraperAPI account;
 * local development falls back to a normal request for fixture-friendly use.
 */
export async function fetchRenderedPage(
  targetUrl: string,
  options: RenderedPageOptions = {},
): Promise<RenderedPage> {
  const apiKey = process.env.SCRAPER_API_KEY?.trim()
  const requestUrl = apiKey ? scraperApiUrl(targetUrl, apiKey, options) : targetUrl
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetch(requestUrl, {
      headers: apiKey
        ? { Accept: 'text/html,application/xhtml+xml' }
        : {
            Accept: 'text/html,application/xhtml+xml',
            'User-Agent':
              'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) ' +
              'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          },
      redirect: 'follow',
      signal: controller.signal,
      cache: 'no-store',
    })

    const html = await response.text()
    if (!response.ok) {
      throw new Error(`Rendered page request failed (${response.status})`)
    }
    if (!html.trim()) {
      throw new Error('Rendered page request returned an empty response')
    }

    return { html, requestedUrl: targetUrl }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Rendered page request timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function scriptContents(html: string): string[] {
  return Array.from(html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi), (match) => match[1] || '')
}

export function scriptById(html: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const pattern = new RegExp(
    `<script\\b[^>]*\\bid=["']${escaped}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    'i',
  )
  return html.match(pattern)?.[1]?.trim() || null
}
