// County Property Enrichment Service
// Queries county assessor systems for property data

import { chromium, Browser, Page } from 'playwright'

export interface EnrichmentInput {
  address: string
  city?: string
  state: string
  zip?: string
  county: string
  manifest_id?: string
}

export interface EnrichmentResult {
  success: boolean
  county: string
  parcelId?: string
  ownerName?: string
  mailingAddress?: string
  appraisedValue?: number
  assessedValue?: number
  landValue?: number
  improvementValue?: number
  taxOwed?: number
  taxStatus?: string
  yearBuilt?: number
  sqft?: number
  bedrooms?: number
  bathrooms?: number
  propertyType?: string
  source?: string
  fetchedAt?: string
  error?: string
  rawData?: any
}

export class CountyEnrichmentService {
  private browser: Browser | null = null
  private readonly timeout = 30000

  async init() {
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

  /**
   * Main enrichment router
   */
  async enrich(input: EnrichmentInput): Promise<EnrichmentResult> {
    try {
      await this.init()

      const state = input.state.toUpperCase()
      const county = input.county.toLowerCase()

      if (state === 'KS' && county === 'johnson') {
        return await this.enrichJohnsonCountyKS(input)
      } else if (state === 'KS' && county === 'wyandotte') {
        return await this.enrichWyandotteCountyKS(input)
      } else if (state === 'MO' && county === 'jackson') {
        return await this.enrichJacksonCountyMO(input)
      } else if (state === 'MO' && county === 'clay') {
        return await this.enrichClayCountyMO(input)
      } else {
        return {
          success: false,
          county: input.county,
          error: `County not supported: ${county}, ${state}`,
        }
      }
    } catch (err: any) {
      return {
        success: false,
        county: input.county,
        error: err.message || 'Enrichment failed',
      }
    } finally {
      await this.close()
    }
  }

  /**
   * Johnson County, KS — API-based parcel lookup
   * NOTE: Full property detail scraping is limited by questionnaire redirects
   */
  private async enrichJohnsonCountyKS(
    input: EnrichmentInput
  ): Promise<EnrichmentResult> {
    // Johnson County KS — AIMS portal XML API (no auth, no Playwright needed)
    // GET https://ims.jocogov.org/locationservices/ajaxreq.aspx?id={address}&type=
    try {
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        Referer: 'https://ims.jocogov.org/locationservices/',
      }

      const url = `https://ims.jocogov.org/locationservices/ajaxreq.aspx?id=${encodeURIComponent(input.address)}&type=`
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
      if (!res.ok) throw new Error(`Johnson County AIMS returned ${res.status}`)

      const xml = await res.text()
      if (!xml.includes('<Propinfo>') || !xml.includes('<Table>')) {
        return { success: false, county: 'Johnson', error: 'Address not found in Johnson County records' }
      }

      // Parse XML fields
      const getField = (tag: string): string => {
        const m = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
        return m ? m[1].trim() : ''
      }

      const ownerName = getField('Owner1FullName')
      const ownAddLine1 = getField('OwnAddLine1')
      const ownAddLine2 = getField('OwnAddLine2')
      const mailingAddress = [ownAddLine1, ownAddLine2].filter(Boolean).join(', ')
      const totalValue = parseFloat(getField('TotalValue') || '0')
      const assessedValue = parseFloat(getField('AssessedTotalValue') || '0')
      const yearBuilt = parseInt(getField('YearBuilt') || '0')
      const parcelId = getField('TaxPropertyID') || getField('GeoPropertyID')
      const kupn = getField('KUPN')
      const quickRef = getField('QuickRefID')
      const taxYearsPastDue = getField('TaxYearsPastDue2')
      const numYearsPastDue = parseInt(getField('NumYearsPastDue') || '0')
      const legalDesc = getField('LegalDesc')
      const situsCity = getField('SitusCity')
      const situsZip = getField('SitusZipCode')
      const lat = parseFloat(getField('Latitude') || '0')
      const lng = parseFloat(getField('Longitude') || '0')

      const taxStatus = numYearsPastDue > 0 || taxYearsPastDue
        ? `delinquent — years past due: ${taxYearsPastDue || numYearsPastDue}`
        : 'current'

      return {
        success: true,
        county: 'Johnson',
        parcelId: parcelId || undefined,
        ownerName: ownerName || undefined,
        mailingAddress: mailingAddress || undefined,
        appraisedValue: totalValue || undefined,
        assessedValue: assessedValue || undefined,
        yearBuilt: yearBuilt || undefined,
        taxStatus,
        taxOwed: numYearsPastDue > 0 ? undefined : 0, // exact amount not in this API
        source: 'johnson_county_aims',
        fetchedAt: new Date().toISOString(),
        rawData: {
          kupn,
          quickRef,
          legalDesc,
          situsCity,
          situsZip,
          taxYearsPastDue,
          numYearsPastDue,
          lat,
          lng,
        },
      }
    } catch (err: any) {
      return { success: false, county: 'Johnson', error: err.message }
    }
  }

  /**
   * Jackson County, MO — Playwright-based
   */
  private async enrichJacksonCountyMO(
    input: EnrichmentInput
  ): Promise<EnrichmentResult> {
    // Jackson County MO uses iasWorld portal at publicaccess.jacksongov.org
    // Must accept disclaimer, then search by address
    try {
      if (!this.browser) throw new Error('Browser not initialized')
      const page = await this.browser.newPage()
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      })

      try {
        // Step 1: Accept disclaimer
        await page.goto(
          'https://publicaccess.jacksongov.org/Search/Disclaimer.aspx?FromUrl=../search/commonsearch.aspx?mode=realprop',
          { waitUntil: 'domcontentloaded', timeout: this.timeout }
        )
        await page.waitForTimeout(500)

        // Click "I Agree" or similar disclaimer button
        const agreeBtn = page.locator('input[value*="Agree"], input[value*="agree"], a:has-text("Agree"), button:has-text("Agree")').first()
        if (await agreeBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
          await agreeBtn.click()
          await page.waitForTimeout(1000)
        }

        // Step 2: Navigate to real property search
        await page.goto(
          'https://publicaccess.jacksongov.org/search/commonsearch.aspx?mode=realprop',
          { waitUntil: 'domcontentloaded', timeout: this.timeout }
        )
        await page.waitForTimeout(500)

        // Step 3: Fill address search
        const addressInput = page.locator('input[name*="Address"], input[id*="Address"], input[name*="street"], input[id*="street"]').first()
        if (await addressInput.isVisible({ timeout: 3000 }).catch(() => false)) {
          await addressInput.fill(input.address)
          await page.keyboard.press('Enter')
          await page.waitForTimeout(2000)
        }

        // Step 4: Click first result if on results page
        const firstResult = page.locator('table.SearchResults tr td a, .SearchResults a').first()
        if (await firstResult.isVisible({ timeout: 3000 }).catch(() => false)) {
          await firstResult.click()
          await page.waitForTimeout(2000)
        }

        // Step 5: Scrape detail page
        const scrapedData = await page.evaluate(() => {
          const getText = (label: string) => {
            const els = Array.from(document.querySelectorAll('td, th, label, span'))
            for (let i = 0; i < els.length; i++) {
              if (els[i].textContent?.toLowerCase().includes(label.toLowerCase())) {
                const next = els[i + 1] || els[i].nextElementSibling
                if (next?.textContent?.trim()) return next.textContent.trim()
              }
            }
            return ''
          }
          const bodyText = document.body.innerText
          const dollarMatch = (label: string) => {
            const m = bodyText.match(new RegExp(label + '[^\\d]*([\\d,]+)', 'i'))
            return m ? parseInt(m[1].replace(/,/g, '')) : 0
          }
          const yearMatch = bodyText.match(/Year Built[:\s]*([0-9]{4})/i)
          const sqftMatch = bodyText.match(/(?:Sq\.?\s*Ft\.?|Square Feet|Living Area)[:\s]*([0-9,]+)/i)
          const parcelMatch = bodyText.match(/Parcel\s*(?:ID|Number|No\.?)[:\s]*([0-9\-]+)/i)

          return {
            ownerName: getText('Owner') || getText('Name'),
            mailingAddress: getText('Mailing'),
            appraisedValue: dollarMatch('Appraised') || dollarMatch('Market Value'),
            assessedValue: dollarMatch('Assessed'),
            parcelId: parcelMatch ? parcelMatch[1].trim() : '',
            yearBuilt: yearMatch ? parseInt(yearMatch[1]) : 0,
            sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : 0,
            rawText: bodyText.substring(0, 500),
          }
        })

        return {
          success: true,
          county: 'Jackson',
          parcelId: scrapedData.parcelId || undefined,
          ownerName: scrapedData.ownerName || undefined,
          mailingAddress: scrapedData.mailingAddress || undefined,
          appraisedValue: scrapedData.appraisedValue || undefined,
          assessedValue: scrapedData.assessedValue || undefined,
          yearBuilt: scrapedData.yearBuilt || undefined,
          sqft: scrapedData.sqft || undefined,
          source: 'jackson_county_assessor',
          fetchedAt: new Date().toISOString(),
          rawData: scrapedData,
        }
      } finally {
        await page.close()
      }
    } catch (err: any) {
      return { success: false, county: 'Jackson', error: err.message }
    }
  }

  /**
   * Wyandotte County, KS — Playwright-based
   */
  private async enrichWyandotteCountyKS(
    input: EnrichmentInput
  ): Promise<EnrichmentResult> {
    try {
      if (!this.browser) throw new Error('Browser not initialized')
      const page = await this.browser.newPage()

      try {
        // Step 1: Search for property
        const searchQuery = encodeURIComponent(input.address)
        const searchUrl = `https://appr.wycokck.org/Property-Search-Result/searchtext/${searchQuery}`

        await page.goto(searchUrl, {
          waitUntil: 'networkidle',
          timeout: this.timeout,
        })

        // Extract first result from table
        const firstResult = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('tbody tr'))
          if (rows.length === 0) return null

          const row = rows[0]
          const cells = Array.from(row.querySelectorAll('td'))

          return {
            propertyId: cells[0]?.textContent?.trim() || '',
            parcelId: cells[1]?.textContent?.trim() || '',
            ownerName: cells[3]?.textContent?.trim() || '',
            address: cells[4]?.textContent?.trim() || '',
            assessedValue: cells[5]?.textContent?.trim() || '',
          }
        })

        if (!firstResult || !firstResult.propertyId) {
          return {
            success: false,
            county: 'Wyandotte',
            error: 'Address not found in Wyandotte County records',
          }
        }

        // Step 2: Get detail page
        const detailUrl = `https://appr.wycokck.org/Property-Detail/PropertyQuickRefID/${firstResult.propertyId}/PartyQuickRefID/${firstResult.parcelId}/`
        await page.goto(detailUrl, {
          waitUntil: 'networkidle',
          timeout: this.timeout,
        })
        await page.waitForTimeout(1500)

        // Scrape detail page
        const detail = await page.evaluate(() => {
          const bodyText = document.body.innerText

          const appraisedMatch = bodyText.match(/Appraised[:\s]*Value[:\s]*\$?([0-9,]+)/i)
          const yearMatch = bodyText.match(/Year Built[:\s]*([0-9]{4})/i)
          const sqftMatch = bodyText.match(/(?:Sq\.?\s*Ft\.?|Square Feet)[:\s]*([0-9,]+)/i)
          const acresMatch = bodyText.match(/Acres[:\s]*([0-9.]+)/i)
          const typeMatch = bodyText.match(/Property Type[:\s]*([^\n]+)/i)

          return {
            appraisedValue: appraisedMatch
              ? parseInt(appraisedMatch[1].replace(/,/g, ''))
              : 0,
            yearBuilt: yearMatch ? parseInt(yearMatch[1]) : 0,
            sqft: sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : 0,
            acres: acresMatch ? parseFloat(acresMatch[1]) : 0,
            propertyType: typeMatch ? typeMatch[1].trim() : '',
            rawText: bodyText.substring(0, 1000),
          }
        })

        return {
          success: true,
          county: 'Wyandotte',
          parcelId: firstResult.parcelId,
          ownerName: firstResult.ownerName || undefined,
          appraisedValue: detail.appraisedValue || undefined,
          assessedValue: firstResult.assessedValue
            ? parseInt(firstResult.assessedValue.replace(/[^0-9]/g, ''))
            : undefined,
          yearBuilt: detail.yearBuilt || undefined,
          sqft: detail.sqft || undefined,
          propertyType: detail.propertyType || undefined,
          source: 'wyandotte_county_assessor',
          fetchedAt: new Date().toISOString(),
          rawData: { ...firstResult, ...detail },
        }
      } finally {
        await page.close()
      }
    } catch (err: any) {
      return {
        success: false,
        county: 'Wyandotte',
        error: err.message,
      }
    }
  }

  /**
   * Clay County, MO — REST API based
   */
  private async enrichClayCountyMO(
    input: EnrichmentInput
  ): Promise<EnrichmentResult> {
    // Clay County uses a clean REST API — no Playwright needed
    // Requires Referer header: https://gisweb.claycountymo.gov/ps/
    const BASE = 'https://gisweb.claycountymo.gov/pub/rest'
    const headers = {
      Referer: 'https://gisweb.claycountymo.gov/ps/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'application/json',
    }

    try {
      // Step 1: Search by situs (street name only — API matches on street name)
      // Extract street name: "1234 N Jefferson St" → "Jefferson"
      const streetName = input.address
        .replace(/^\d+\s+/, '')           // remove house number
        .replace(/\b(N|S|E|W|NE|NW|SE|SW)\.?\s+/i, '') // remove direction prefix
        .replace(/\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Pl|Ter|Way|Cir|Pkwy)\.?\s*$/i, '') // remove suffix
        .trim()

      const searchRes = await fetch(
        `${BASE}/parcels?situs=${encodeURIComponent(streetName)}`,
        { headers, signal: AbortSignal.timeout(15000) }
      )
      if (!searchRes.ok) throw new Error(`Clay search returned ${searchRes.status}`)

      const allParcels = await searchRes.json()
      if (!Array.isArray(allParcels) || allParcels.length === 0) {
        return { success: false, county: 'Clay', error: 'Address not found in Clay County records' }
      }

      // Match by house number
      const houseNum = input.address.match(/^(\d+)/)?.[1] || ''
      const parcel = allParcels.find((p: any) =>
        p.situs && houseNum && p.situs.toString().startsWith(houseNum)
      ) || allParcels[0]
      const propId = parcel.prop_id
      if (!propId) throw new Error('No prop_id returned from Clay County search')

      // Step 2: Fetch detail, dwelling, and value in parallel
      const [detailRes, dwellingRes, valueRes] = await Promise.all([
        fetch(`${BASE}/parcel/${propId}`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${BASE}/parcel/${propId}/dwelling`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${BASE}/parcel/${propId}/value`, { headers, signal: AbortSignal.timeout(10000) }),
      ])

      const detail = detailRes.ok ? await detailRes.json() : []
      const dwelling = dwellingRes.ok ? await dwellingRes.json() : []
      const value = valueRes.ok ? await valueRes.json() : []

      const d = Array.isArray(detail) ? detail[0] || {} : detail
      const dw = Array.isArray(dwelling) ? dwelling[0] || {} : dwelling
      const v = Array.isArray(value)
        ? (value.find((x: any) => x.val_yr === 'current year') || value[0] || {})
        : value

      const mailingAddress = [d.owner_street, d.owner_city, d.owner_state, d.owner_zip]
        .filter(Boolean).join(', ')

      return {
        success: true,
        county: 'Clay',
        parcelId: parcel.parcel_id || parcel.parcelid || undefined,
        ownerName: d.current_owner || d.owner_name || undefined,
        mailingAddress: mailingAddress || undefined,
        appraisedValue: v.appraised_val ? parseFloat(v.appraised_val) : undefined,
        assessedValue: v.assessed_val ? parseFloat(v.assessed_val) : undefined,
        landValue: v.land_val ? parseFloat(v.land_val) : undefined,
        improvementValue: v.imprv_val ? parseFloat(v.imprv_val) : undefined,
        yearBuilt: dw.actual_year_built ? parseInt(dw.actual_year_built) : undefined,
        sqft: dw.total_area ? parseFloat(dw.total_area) : undefined,
        bedrooms: dw.bedrooms ? parseFloat(dw.bedrooms) : undefined,
        bathrooms: dw.bathrooms ? parseFloat(dw.bathrooms) : undefined,
        propertyType: d.use_code || undefined,
        source: 'clay_county_assessor',
        fetchedAt: new Date().toISOString(),
        rawData: { parcel, detail: d, dwelling: dw, value: v },
      }
    } catch (err: any) {
      return { success: false, county: 'Clay', error: err.message }
    }
  }
}
