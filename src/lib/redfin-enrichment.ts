// Redfin Property Enrichment
// Pulls Redfin's home estimate by navigating Redfin's public property page
// and parsing structured data (__INITIAL_STATE__ or __REDUX_STATE__ JSON blob).
// Falls back to targeted text selectors if the JSON path changes.

// Dynamic import to handle optional Playwright dependency (not available on Vercel)
let chromium: any
try {
  const playwright = require('playwright')
  chromium = playwright.chromium
} catch (e) {
  console.warn('[Redfin] Playwright not available - enrichment disabled')
}

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

export class RedfinEnrichmentService {
  private browser: any = null
  private readonly timeout = 45000

  async init() {
    if (!chromium) {
      throw new Error('Playwright not available - Redfin enrichment disabled on this platform')
    }
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-dev-shm-usage',
      ],
    })
  }

  async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  async enrich(input: RedfinInput): Promise<RedfinResult> {
    const { address, city, state, zip } = input
    console.log('[Redfin] Enriching:', address, city, state, zip)

    if (!this.browser) await this.init()

    const context = await this.browser!.newContext({
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      viewport: { width: 1440, height: 900 },
    })
    const page = await context.newPage()

    try {
      // Redfin's search: paste the address and click the first result.
      // There is no clean URL we can always construct without the zpid-equivalent,
      // so we let Redfin's autocomplete resolve it.
      await page.goto('https://www.redfin.com/', {
        waitUntil: 'domcontentloaded',
        timeout: this.timeout,
      })

      const fullAddr = `${address}, ${city}, ${state}${zip ? ' ' + zip : ''}`
      const searchInput = page
        .locator('input[placeholder*="Address"], input[name*="search"], input[aria-label*="Search"]')
        .first()
      await searchInput.waitFor({ state: 'visible', timeout: 10_000 })
      await searchInput.fill(fullAddr)
      await page.waitForTimeout(1500)

      // Click the first autocomplete result (it's usually the exact address)
      try {
        const firstResult = page.locator('.search-result-item, a[href*="/home/"]').first()
        await firstResult.click({ timeout: 8_000 })
      } catch {
        // Fallback: hit enter
        await searchInput.press('Enter')
      }

      await page.waitForLoadState('domcontentloaded')
      await page.waitForTimeout(2500)

      const url = page.url()
      console.log('[Redfin] Landed on:', url)

      // If we're on a search results listing, try to navigate into a /home/ detail page.
      if (!url.includes('/home/') && !url.includes('/MO/') && !url.includes('/KS/')) {
        try {
          const firstListing = page.locator('a[href*="/home/"]').first()
          await firstListing.click({ timeout: 5_000 })
          await page.waitForLoadState('domcontentloaded')
          await page.waitForTimeout(2000)
        } catch {
          /* continue — may already be a detail page */
        }
      }

      const result: RedfinResult = {
        success: true,
        source: 'redfin',
        fetchedAt: new Date().toISOString(),
        url: page.url(),
      }

      // Primary path: pull from the embedded __REACT_QUERY_STATE__ / __INITIAL_STATE__
      try {
        const scripts = await page.locator('script').allTextContents()
        for (const s of scripts) {
          if (!s || s.length < 500) continue
          if (!/redfinEstimate|"estimate"\s*:\s*\{/.test(s)) continue

          // Look for redfinEstimate as a nested object
          const m1 = s.match(/"redfinEstimate"\s*:\s*\{[^}]*"estimate"\s*:\s*(\d+)/)
          if (m1) {
            result.redfinEstimate = parseInt(m1[1], 10)
          }
          // Alternate shape
          const m2 = s.match(/"estimate"\s*:\s*(\d{4,})/)
          if (!result.redfinEstimate && m2) {
            result.redfinEstimate = parseInt(m2[1], 10)
          }

          const yb = s.match(/"yearBuilt"\s*:\s*(\d{4})/)
          if (yb) result.yearBuilt = parseInt(yb[1], 10)
          const lsp = s.match(/"lastSoldPrice"\s*:\s*(\d+)/)
          if (lsp) result.lastSalePrice = parseInt(lsp[1], 10)
          const lsd = s.match(/"lastSoldDate"\s*:\s*"?(\d{4}-\d{2}-\d{2})"?/)
          if (lsd) result.lastSaleDate = lsd[1]

          if (result.redfinEstimate) break
        }
      } catch (err: any) {
        console.log('[Redfin] __INITIAL_STATE__ parse failed:', err.message)
      }

      // Fallback: DOM selector for the visible "Redfin Estimate" chip
      if (!result.redfinEstimate) {
        try {
          const text = await page
            .locator('text=/Redfin Estimate/i')
            .first()
            .locator('xpath=..')
            .textContent({ timeout: 3_000 })
          if (text) {
            const m = text.match(/\$([\d,]+)/)
            if (m) result.redfinEstimate = parseInt(m[1].replace(/,/g, ''), 10)
          }
        } catch {
          /* ignore */
        }
      }

      console.log('[Redfin] Extracted:', {
        estimate: result.redfinEstimate,
        yearBuilt: result.yearBuilt,
      })

      if (!result.redfinEstimate) {
        return {
          success: false,
          source: 'redfin',
          fetchedAt: new Date().toISOString(),
          error: 'Could not extract Redfin estimate',
          url: page.url(),
        }
      }

      return result
    } catch (err: any) {
      console.error('[Redfin] Enrichment failed:', err.message)
      return {
        success: false,
        source: 'redfin',
        fetchedAt: new Date().toISOString(),
        error: err.message,
      }
    } finally {
      await context.close().catch(() => {})
    }
  }
}

export async function enrichFromRedfin(input: RedfinInput): Promise<RedfinResult> {
  const service = new RedfinEnrichmentService()
  await service.init()
  try {
    return await service.enrich(input)
  } finally {
    await service.close()
  }
}
