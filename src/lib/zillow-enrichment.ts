// Zillow Property Enrichment Service
// Supplements county data with lot size, sale history, tax info

// Dynamic import to handle optional Playwright dependency (not available on Vercel)
let chromium: any

try {
  const playwright = require('playwright')
  chromium = playwright.chromium
} catch (e) {
  console.warn('[Zillow] Playwright not available - Zillow enrichment disabled')
}

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
  rawData?: any
}

export class ZillowEnrichmentService {
  private browser: any = null
  private readonly timeout = 60000 // Increased to 60 seconds

  async init() {
    if (!chromium) {
      throw new Error('Playwright not available - Zillow enrichment disabled on this platform')
    }
    this.browser = await chromium.launch({
      headless: true,
      timeout: this.timeout,
    })
  }

  async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  async enrich(input: ZillowInput): Promise<ZillowResult> {
    const { address, city, state, zip } = input

    console.log('[Zillow] Enriching:', address, city, state, zip)

    if (!this.browser) {
      await this.init()
    }

    const page = await this.browser!.newPage()

    try {
      // Build Zillow search URL
      // If address already contains city/state/zip (e.g., "123 Main St, Kansas City, MO 64110"),
      // use it as-is. Otherwise, build the full address.
      let searchAddress = address
      const hasFullAddress = address.match(/,.*[A-Z]{2}\s*\d{5}/)

      if (!hasFullAddress) {
        // Address is just street (e.g., "123 Main St"), append city/state/zip
        searchAddress = `${address}, ${city}, ${state}${zip ? ' ' + zip : ''}`
      }

      const encodedAddress = encodeURIComponent(searchAddress)
      const searchUrl = `https://www.zillow.com/homes/${encodedAddress.replace(/%20/g, '-')}_rb/`

      console.log('[Zillow] Navigating to:', searchUrl)

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded', // Changed from networkidle - Zillow has lots of tracking scripts
        timeout: this.timeout
      })

      // Wait for page to render
      await page.waitForTimeout(3000)

      // Check if we landed on a property page or search results
      const url = page.url()
      const isPropertyPage = url.includes('/homedetails/')

      console.log('[Zillow] Landed on URL:', url, 'isPropertyPage:', isPropertyPage)

      if (!isPropertyPage) {
        // We might be on search results - try to find and click first result
        try {
          // Wait for either search results OR direct property page indicators
          await Promise.race([
            page.locator('article a[data-test="property-card-link"]').first().waitFor({ timeout: 5000 }),
            page.locator('h1').first().waitFor({ timeout: 5000 })
          ]).catch(() => {
            console.log('[Zillow] Neither search results nor property page loaded quickly')
          })

          // Check again if we're now on a property page (might have redirected)
          const currentUrl = page.url()
          if (currentUrl.includes('/homedetails/') || currentUrl.includes('/b/')) {
            console.log('[Zillow] Redirected to property page')
            // Already on property page, proceed
          } else {
            // Try clicking first search result
            const firstResult = page.locator('article a[data-test="property-card-link"]').first()
            const resultCount = await page.locator('article a[data-test="property-card-link"]').count()

            console.log('[Zillow] Found', resultCount, 'search results')

            if (resultCount > 0) {
              await firstResult.click({ timeout: 10000 })
              await page.waitForLoadState('domcontentloaded')
              await page.waitForTimeout(3000)
            } else {
              console.error('[Zillow] No search results found')
              return {
                success: false,
                error: 'Property not found on Zillow - no search results',
                source: 'zillow',
                fetchedAt: new Date().toISOString()
              }
            }
          }
        } catch (err: any) {
          console.error('[Zillow] Search results navigation failed:', err.message)

          // One last check - maybe we're on the property page anyway
          const finalUrl = page.url()
          if (!finalUrl.includes('/homedetails/') && !finalUrl.includes('/b/')) {
            return {
              success: false,
              error: 'Property not found on Zillow',
              source: 'zillow',
              fetchedAt: new Date().toISOString()
            }
          }
          console.log('[Zillow] Continuing anyway, might be on property page')
        }
      }

      // Extract property data
      const result: ZillowResult = {
        success: true,
        source: 'zillow',
        fetchedAt: new Date().toISOString()
      }

      // ── Primary path: read __NEXT_DATA__ JSON blob (stable across UI changes)
      try {
        const nextDataRaw = await page
          .locator('script#__NEXT_DATA__')
          .first()
          .textContent({ timeout: 2000 })
        if (nextDataRaw) {
          const nextData = JSON.parse(nextDataRaw)
          const home = findHomeInfo(nextData)
          if (home) {
            if (typeof home.zestimate === 'number' && home.zestimate > 0) {
              result.zestimate = home.zestimate
            }
            if (typeof home.rentZestimate === 'number' && home.rentZestimate > 0) {
              result.rentZestimate = home.rentZestimate
            }
            if (typeof home.yearBuilt === 'number' && home.yearBuilt > 0) {
              result.yearBuilt = home.yearBuilt
            }
            if (typeof home.taxAssessedValue === 'number' && home.taxAssessedValue > 0) {
              result.taxAssessment = home.taxAssessedValue
            }
            if (typeof home.lotAreaValue === 'number' && home.lotAreaValue > 0) {
              const unit = (home.lotAreaUnit || '').toString().toLowerCase()
              if (unit.includes('acre')) {
                result.lotSizeAcres = home.lotAreaValue
                result.lotSizeSqft = Math.round(home.lotAreaValue * 43560)
              } else {
                result.lotSizeSqft = home.lotAreaValue
                result.lotSizeAcres = home.lotAreaValue / 43560
              }
            }
            if (typeof home.dateSold === 'number' && home.dateSold > 0) {
              result.lastSaleDate = new Date(home.dateSold).toISOString().slice(0, 10)
            }
            if (typeof home.lastSoldPrice === 'number' && home.lastSoldPrice > 0) {
              result.lastSalePrice = home.lastSoldPrice
            }
            console.log('[Zillow] Extracted from __NEXT_DATA__:', {
              zestimate: result.zestimate,
              yearBuilt: result.yearBuilt,
              taxAssessment: result.taxAssessment,
            })
          } else {
            console.log('[Zillow] __NEXT_DATA__ present but no homeInfo found')
          }
        }
      } catch (err: any) {
        console.log('[Zillow] __NEXT_DATA__ parse failed:', err.message)
      }

      // Lot size - look for "Lot: X acres" or "X sqft"
      try {
        const lotText = await page.locator('span:has-text("Lot:")').first().textContent()
        if (lotText) {
          const acresMatch = lotText.match(/([\d,\.]+)\s*Acres?/i)
          const sqftMatch = lotText.match(/([\d,]+)\s*sqft/i)

          if (acresMatch) {
            result.lotSizeAcres = parseFloat(acresMatch[1].replace(/,/g, ''))
            result.lotSizeSqft = Math.round(result.lotSizeAcres * 43560)
          } else if (sqftMatch) {
            result.lotSizeSqft = parseInt(sqftMatch[1].replace(/,/g, ''))
            result.lotSizeAcres = result.lotSizeSqft / 43560
          }
        }
      } catch {}

      // Year built
      try {
        const yearText = await page.locator('span:has-text("Built in")').first().textContent()
        if (yearText) {
          const yearMatch = yearText.match(/Built in (\d{4})/)
          if (yearMatch) {
            result.yearBuilt = parseInt(yearMatch[1])
          }
        }
      } catch {}

      // Last sale - look in price history section
      try {
        await page.locator('button:has-text("Price history")').click()
        await page.waitForTimeout(1000)

        const priceRows = page.locator('[data-testid="price-history-table"] tbody tr')
        const count = await priceRows.count()

        if (count > 0) {
          const firstRow = priceRows.first()
          const cells = firstRow.locator('td')

          const dateText = await cells.nth(0).textContent()
          const priceText = await cells.nth(2).textContent()
          const eventText = await cells.nth(1).textContent()

          if (dateText && priceText) {
            result.lastSaleDate = dateText.trim()
            const priceMatch = priceText.match(/\$?([\d,]+)/)
            if (priceMatch) {
              result.lastSalePrice = parseInt(priceMatch[1].replace(/,/g, ''))
            }
          }
        }
      } catch (err) {
        console.log('[Zillow] Could not extract price history:', err)
      }

      // Tax assessment - look for "Tax Assessment" in facts section
      try {
        const taxText = await page.locator('span:has-text("Tax assessed value")').first().textContent()
        if (taxText) {
          const taxMatch = taxText.match(/\$?([\d,]+)/)
          if (taxMatch) {
            result.taxAssessment = parseInt(taxMatch[1].replace(/,/g, ''))
          }
        }
      } catch {}

      // Zestimate
      try {
        const zestimateText = await page.locator('[data-testid="zestimate-text"]').first().textContent()
        if (zestimateText) {
          const zestMatch = zestimateText.match(/\$?([\d,]+)/)
          if (zestMatch) {
            result.zestimate = parseInt(zestMatch[1].replace(/,/g, ''))
          }
        }
      } catch {}

      console.log('[Zillow] Extracted data:', result)

      await page.close()
      return result

    } catch (error: any) {
      console.error('[Zillow] Enrichment error:', error.message)
      await page.close()

      return {
        success: false,
        error: error.message,
        source: 'zillow',
        fetchedAt: new Date().toISOString()
      }
    }
  }
}

// Standalone function for easy import
export async function enrichFromZillow(input: ZillowInput): Promise<ZillowResult> {
  const service = new ZillowEnrichmentService()
  await service.init()

  try {
    return await service.enrich(input)
  } finally {
    await service.close()
  }
}

/**
 * Walk the __NEXT_DATA__ tree looking for the object that carries Zillow's
 * homeInfo fields (zestimate, yearBuilt, taxAssessedValue, etc). Zillow
 * stores it under different paths depending on page variant, so we scan.
 */
function findHomeInfo(root: unknown): Record<string, any> | null {
  const seen = new WeakSet<object>()
  const queue: unknown[] = [root]
  while (queue.length) {
    const node = queue.shift()
    if (!node || typeof node !== 'object') continue
    if (seen.has(node as object)) continue
    seen.add(node as object)
    const rec = node as Record<string, unknown>
    // Heuristic: an object is the homeInfo if it has zestimate OR
    // zpid+yearBuilt together. This covers both `homeInfo` and
    // `hdpData.homeInfo` variants.
    if (
      typeof rec.zestimate === 'number' ||
      (typeof rec.zpid !== 'undefined' && typeof rec.yearBuilt === 'number')
    ) {
      return rec as Record<string, any>
    }
    for (const v of Object.values(rec)) {
      if (v && typeof v === 'object') queue.push(v)
    }
  }
  return null
}
