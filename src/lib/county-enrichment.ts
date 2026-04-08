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

      const isDelinquent = numYearsPastDue > 0 || !!taxYearsPastDue
      const taxStatus = isDelinquent
        ? `delinquent — years past due: ${taxYearsPastDue || numYearsPastDue}`
        : 'current'

      // Step 2: If delinquent + quickRef available, scrape total tax owed from taxbill.jocogov.org
      let taxOwed: number | undefined = isDelinquent ? undefined : 0
      let currentAmountDue: number | undefined
      let pastYearsDue: number | undefined

      if (isDelinquent && quickRef) {
        try {
          const taxHeaders = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Referer: 'https://taxbill.jocogov.org/',
          }
          // Get session cookie
          await fetch('https://taxbill.jocogov.org/', { headers: taxHeaders, signal: AbortSignal.timeout(8000) })
          const taxRes = await fetch(
            `https://taxbill.jocogov.org/Property-Detail?PropertyQuickRefID=${quickRef}&TaxYear=2025`,
            { headers: taxHeaders, signal: AbortSignal.timeout(12000) }
          )
          if (taxRes.ok) {
            const html = await taxRes.text()
            // Extract: Current Amount Due | Past Years Due | Total Due
            const lines = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split(/(?=\$)/)
            const dollarVal = (label: string): number | undefined => {
              const m = html.match(new RegExp(label + '[^$]*\\$([\\d,]+\\.\\d{2})', 'i'))
              return m ? parseFloat(m[1].replace(/,/g, '')) : undefined
            }
            currentAmountDue = dollarVal('Current Amount Due')
            pastYearsDue = dollarVal('Past Years Due')
            taxOwed = dollarVal('Total Due')
          }
        } catch (_) {
          // Tax balance lookup failed — leave as undefined
        }
      }

      // Step 3: Get full dwelling detail from appraiser (aprdetail)
      // Requires parcel ID with space (not +), POST to ajaxreq.aspx
      let sqft: number | undefined
      let bedrooms: number | undefined
      let bathrooms: number | undefined
      let propertyType: string | undefined
      let propertyStyle: string | undefined
      let basementDesc: string | undefined
      let garageSize: number | undefined
      let exterior: string | undefined
      let roofType: string | undefined
      let hvac: string | undefined
      let hasFireplace: boolean | undefined
      let totalRooms: number | undefined
      let totalBasementSqft: number | undefined
      let finishedBasementSqft: number | undefined
      let deckSqft: number | undefined
      let landValue: number | undefined
      let improvementValue: number | undefined

      if (parcelId) {
        try {
          const aprHeaders = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            Referer: 'https://ims.jocogov.org/locationservices/',
            'Content-Type': 'application/x-www-form-urlencoded',
          }
          // Use parcel ID with space (NP27700011 0027), not + encoded
          const aprBody = new URLSearchParams({ type: 'aprdetail', id: parcelId }).toString()
          const aprRes = await fetch('https://ims.jocogov.org/locationservices/ajaxreq.aspx', {
            method: 'POST',
            headers: aprHeaders,
            body: aprBody,
            signal: AbortSignal.timeout(12000),
          })
          if (aprRes.ok) {
            const aprXml = await aprRes.text()
            const getAPR = (tag: string): string => {
              const m = aprXml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))
              return m ? m[1].trim() : ''
            }
            sqft = parseInt(getAPR('sfla') || '0') || undefined
            bedrooms = parseInt(getAPR('bedrooms') || '0') || undefined
            bathrooms = parseInt(getAPR('full_baths') || '0') || undefined
            propertyType = getAPR('PropTypeCode') || undefined  // SF, MH, etc.
            propertyStyle = getAPR('Style_desc') || undefined
            basementDesc = getAPR('basement_desc') || undefined
            totalRooms = parseInt(getAPR('total_rooms') || '0') || undefined
            finishedBasementSqft = parseInt(getAPR('fin_bsmt_num') || '0') || undefined

            // Parse APRComponents for garage, roof, exterior, HVAC, fireplace
            const compMatches = aprXml.matchAll(/<Description>([^<]+)<\/Description>[\s\S]*?(?:<Units>([\d.]+)<\/Units>)?/g)
            for (const m of compMatches) {
              const desc = m[1].trim()
              const units = parseFloat(m[2] || '0')
              if (desc.includes('Garage') && units > 0 && !garageSize) garageSize = units
              if (desc.includes('Shake') || desc.includes('Shingle') || desc.includes('Metal') || desc.includes('Tile')) roofType = desc
              if (desc.includes('Frame') || desc.includes('Brick') || desc.includes('Vinyl') || desc.includes('Stucco')) exterior = desc
              if (desc.includes('Warmed') || desc.includes('Heated') || desc.includes('Forced') || desc.includes('Electric Baseboard')) hvac = desc
              if (desc.includes('Fireplace')) hasFireplace = true
              if (desc.includes('Total Basement') && units > 0) totalBasementSqft = units
              if (desc.includes('Wood Deck') && units > 0) deckSqft = units
            }
          }
        } catch (_) {
          // APR detail lookup failed — continue without dwelling data
        }
      }

      return {
        success: true,
        county: 'Johnson',
        parcelId: parcelId || undefined,
        ownerName: ownerName || undefined,
        mailingAddress: mailingAddress || undefined,
        appraisedValue: totalValue || undefined,
        assessedValue: assessedValue || undefined,
        yearBuilt: yearBuilt || undefined,
        sqft,
        bedrooms,
        bathrooms,
        propertyType,
        taxStatus,
        taxOwed,
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
          currentAmountDue,
          pastYearsDue,
          propertyStyle,
          basementDesc,
          garageSize,
          exterior,
          roofType,
          hvac,
          hasFireplace,
          totalRooms,
          totalBasementSqft,
          finishedBasementSqft,
          deckSqft,
          lat,
          lng,
        },
      }
    } catch (err: any) {
      return { success: false, county: 'Johnson', error: err.message }
    }
  }

  /**
   * Jackson County, MO — Playwright-based iasWorld scraper
   * Uses publicaccess.jacksongov.org with disclaimer acceptance
   * Searches by PARID (preferred) or address, then scrapes profile/values/residential tabs
   */
  private async enrichJacksonCountyMO(
    input: EnrichmentInput
  ): Promise<EnrichmentResult> {
    try {
      if (!this.browser) throw new Error('Browser not initialized')
      const page = await this.browser.newPage()
      await page.setExtraHTTPHeaders({
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      })

      try {
        // Step 1: Accept disclaimer (sets ASP.NET_SessionId + DISCLAIMER=1 cookies)
        await page.goto(
          'https://publicaccess.jacksongov.org/Search/Disclaimer.aspx?FromUrl=../search/commonsearch.aspx?mode=realprop',
          { waitUntil: 'domcontentloaded', timeout: this.timeout }
        )
        await page.waitForTimeout(500)

        // POST disclaimer acceptance
        const agreeBtn = page.locator('#btAgree, input[id*="Agree"]').first()
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

        // Step 3: Try PARID search first if available
        const paridInput = (input as any).parcelId
        if (paridInput) {
          const paridField = page.locator('#inpParid')
          if (await paridField.isVisible({ timeout: 2000 }).catch(() => false)) {
            await paridField.fill(paridInput)
            await page.locator('#btSearch').click()
            await page.waitForTimeout(2000)
          }
        } else {
          // Step 4: Address search — parse house number, street name, suffix
          const addressParts = this.parseJacksonAddress(input.address)

          if (addressParts.houseNumber) {
            await page.locator('#inpNo').fill(addressParts.houseNumber)
          }
          if (addressParts.streetName) {
            await page.locator('#inpStreet').fill(addressParts.streetName)
          }
          if (addressParts.suffix) {
            // Select suffix from dropdown
            await page.locator('#inpSuf').selectOption({ value: addressParts.suffix })
          }

          await page.locator('#btSearch').click()
          await page.waitForTimeout(2000)
        }

        // Step 5: Wait for either .WidgetBar (results) or a "no records" indicator
        // The search may redirect to datalet (1 result), show results list, or show "no records"
        try {
          await Promise.race([
            page.waitForSelector('.WidgetBar', { timeout: 15000 }),
            page.waitForSelector('.SearchResults', { timeout: 15000 }),
            page.locator('text=did not find any records').waitFor({ timeout: 15000 }),
            page.locator('text=No records found').waitFor({ timeout: 15000 }),
          ])
        } catch {
          // None of the expected elements appeared — check page content
          const bodyText = await page.evaluate(() => document.body.innerText)
          if (bodyText.includes('did not find') || bodyText.includes('No records')) {
            return { success: false, county: 'Jackson', error: 'Address not found in Jackson County records' }
          }
          // Try waiting a bit longer for slow loads
          await page.waitForSelector('.WidgetBar', { timeout: 10000 })
        }

        // Check for "no records found" message
        const noRecordsMsg = await page.evaluate(() => {
          const text = document.body.innerText
          return text.includes('did not find any records') || text.includes('No records found')
        })
        if (noRecordsMsg) {
          return { success: false, county: 'Jackson', error: 'Address not found in Jackson County records' }
        }

        // If we're on a search results list (multiple results), click the first result
        const isOnDatalet = page.url().includes('/Datalets/') || page.url().includes('/datalets/')
        if (!isOnDatalet) {
          const firstResultLink = page.locator('a[href*="Datalet"], a[href*="datalet"]').first()
          if (await firstResultLink.isVisible({ timeout: 3000 }).catch(() => false)) {
            await firstResultLink.click()
            await page.waitForTimeout(2000)
            await page.waitForSelector('.WidgetBar', { timeout: 10000 })
          }
        }

        // Extract inline profile data from initial search results
        const profileText = await page.evaluate(() => {
          const widget = document.querySelector('.WidgetBar') as HTMLElement | null
          return widget?.innerText || ''
        })

        // Step 6: Navigate to values tab
        await page.goto(
          'https://publicaccess.jacksongov.org/datalets/datalet.aspx?mode=valuesall&sIndex=0&idx=1&LMparent=20',
          { waitUntil: 'domcontentloaded', timeout: this.timeout }
        )
        await page.waitForSelector('.WidgetBar', { timeout: 15000 })
        const valuesText = await page.evaluate(() => {
          const widget = document.querySelector('.WidgetBar') as HTMLElement | null
          return widget?.innerText || ''
        })

        // Step 7: Navigate to residential tab
        await page.goto(
          'https://publicaccess.jacksongov.org/datalets/datalet.aspx?mode=residential&sIndex=0&idx=1&LMparent=20',
          { waitUntil: 'domcontentloaded', timeout: this.timeout }
        )
        await page.waitForSelector('.WidgetBar', { timeout: 15000 })
        const residentialText = await page.evaluate(() => {
          const widget = document.querySelector('.WidgetBar') as HTMLElement | null
          return widget?.innerText || ''
        })

        // Step 8: Parse all data
        const parsed = this.parseJacksonCountyData(profileText, valuesText, residentialText)

        // Step 9: Fetch tax collection data (delinquency, bankruptcy, payment history)
        let taxData: any = {}
        if (parsed.paridFormatted) {
          taxData = await this.enrichJacksonCountyTaxCollection(parsed.paridFormatted)
        }

        // Step 10: Check out-of-state ownership
        const outOfState = parsed.mailingState && parsed.mailingState !== 'MO'

        return {
          success: true,
          county: 'Jackson',
          parcelId: parsed.paridFormatted || undefined,
          ownerName: parsed.ownerName || undefined,
          mailingAddress: parsed.mailingAddress || undefined,
          appraisedValue: parsed.appraisedValue || undefined,
          assessedValue: parsed.assessedValue || undefined,
          landValue: parsed.landValue || undefined,
          improvementValue: parsed.improvementValue || undefined,
          taxOwed: taxData.taxOwed || undefined,
          taxStatus: taxData.taxStatus || undefined,
          yearBuilt: parsed.yearBuilt || undefined,
          sqft: parsed.sqft || undefined,
          bedrooms: parsed.bedrooms || undefined,
          bathrooms: parsed.bathrooms || undefined,
          propertyType: parsed.propertyType || undefined,
          source: 'jackson_county_assessor',
          fetchedAt: new Date().toISOString(),
          rawData: {
            ...parsed,
            outOfState,
            yearsDelinquent: taxData.yearsDelinquent,
            lastPaymentDate: taxData.lastPaymentDate,
            lastPaymentAmount: taxData.lastPaymentAmount,
            delinquentBills: taxData.delinquentBills,
            isBankruptcy: taxData.isBankruptcy,
            taxCollectionError: taxData.error,
            profileText: profileText.substring(0, 500),
            valuesText: valuesText.substring(0, 500),
            residentialText: residentialText.substring(0, 500),
          },
        }
      } finally {
        await page.close()
      }
    } catch (err: any) {
      return { success: false, county: 'Jackson', error: err.message }
    }
  }

  /**
   * Parse Jackson County address into components for iasWorld search form
   */
  private parseJacksonAddress(address: string): {
    houseNumber: string
    streetName: string
    suffix: string
  } {
    // Strip city/state/zip — only keep the street portion before the first comma
    let streetOnly = address.split(',')[0].trim()

    const suffixMap: Record<string, string> = {
      'AVE': 'AVE', 'AVENUE': 'AVE',
      'BLVD': 'BLVD', 'BOULEVARD': 'BLVD',
      'CIR': 'CIR', 'CIRCLE': 'CIR',
      'CT': 'CT', 'COURT': 'CT',
      'DR': 'DR', 'DRIVE': 'DR',
      'HWY': 'HWY', 'HIGHWAY': 'HWY',
      'LN': 'LN', 'LANE': 'LN',
      'PKWY': 'PKWY', 'PARKWAY': 'PKWY',
      'PL': 'PL', 'PLACE': 'PL',
      'RD': 'RD', 'ROAD': 'RD',
      'ST': 'ST', 'STREET': 'ST',
      'TER': 'TER', 'TERRACE': 'TER',
      'TRL': 'TRL', 'TRAIL': 'TRL',
      'WAY': 'WAY',
    }

    const parts = streetOnly.split(/\s+/)
    const houseNumber = parts[0] || ''

    // Remove house number
    let remaining = parts.slice(1)

    // Remove direction prefix (N, S, E, W, NE, NW, SE, SW)
    const directions = ['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW', 'NORTH', 'SOUTH', 'EAST', 'WEST']
    if (remaining.length > 0 && directions.includes(remaining[0].toUpperCase().replace('.', ''))) {
      remaining = remaining.slice(1)
    }

    // Find suffix ANYWHERE in the remaining parts (not just the last word)
    // This handles "MAYWOOD AVE RAYTOWN" → street="MAYWOOD", suffix="AVE" (strips city)
    let suffix = ''
    let suffixIdx = -1
    for (let i = 0; i < remaining.length; i++) {
      const word = remaining[i].toUpperCase().replace(/[.,]/g, '')
      if (suffixMap[word]) {
        suffix = suffixMap[word]
        suffixIdx = i
        break // Use first suffix found (e.g., AVE in "MAYWOOD AVE RAYTOWN")
      }
    }

    let streetName: string
    if (suffixIdx >= 0) {
      // Take only the words BEFORE the suffix as street name
      streetName = remaining.slice(0, suffixIdx).join(' ')
    } else {
      // No suffix found — use all remaining words but strip common city names
      const commonCities = ['KANSAS CITY', 'INDEPENDENCE', 'RAYTOWN', 'BLUE SPRINGS', 'LEES SUMMIT',
        'GRANDVIEW', 'LIBERTY', 'GLADSTONE', 'EXCELSIOR SPRINGS', 'GRAIN VALLEY', 'OAK GROVE',
        'PLEASANT HILL', 'RAYMORE', 'BELTON', 'HARRISONVILLE', 'PECULIAR', 'OLATHE', 'OVERLAND PARK',
        'SHAWNEE', 'LENEXA', 'LEAWOOD', 'MERRIAM', 'MISSION', 'PRAIRIE VILLAGE']
      const remainingStr = remaining.join(' ').toUpperCase()
      for (const city of commonCities) {
        if (remainingStr.endsWith(city)) {
          streetName = remaining.join(' ').slice(0, -(city.length)).trim()
          return { houseNumber, streetName, suffix }
        }
      }
      streetName = remaining.join(' ')
    }

    return { houseNumber, streetName, suffix }
  }

  /**
   * Parse Jackson County data from profile, values, and residential tabs
   */
  private parseJacksonCountyData(
    profileText: string,
    valuesText: string,
    residentialText: string
  ): {
    paridFormatted?: string
    ownerName?: string
    mailingAddress?: string
    mailingState?: string
    propertyType?: string
    appraisedValue?: number
    assessedValue?: number
    landValue?: number
    improvementValue?: number
    yearBuilt?: number
    sqft?: number
    bedrooms?: number
    bathrooms?: number
    halfBaths?: number
    condition?: string
    exterior?: string
    roofType?: string
    style?: string
    basement?: string
    fireplaces?: number
    physicalCondition?: string
  } {
    const result: any = {}

    // Parse profile data
    const paridMatch = profileText.match(/PARID:\s*([\d]+)/i)
    if (paridMatch) result.paridFormatted = paridMatch[1]

    // Owner name — usually at top of profile
    const ownerMatch = profileText.match(/\n([A-Z][A-Z\s&,.']+)\n/m)
    if (ownerMatch) result.ownerName = ownerMatch[1].trim()

    // Property address
    const addressMatch = profileText.match(/Address\s+([^\n]+)/i)
    const cityMatch = profileText.match(/City, State, Zip\s+([^\n]+)/i)

    // Mailing address (owner's address from Owners section)
    const mailingMatch = profileText.match(/Owners[^]*?Address[^\n]*\n([^\n]+(?:\n[^\n]+)?)/i)
    if (mailingMatch) {
      result.mailingAddress = mailingMatch[1].replace(/\n/g, ', ').trim()
      // Extract state from mailing address
      const stateMatch = result.mailingAddress.match(/\b([A-Z]{2})\s+\d{5}/i)
      if (stateMatch) result.mailingState = stateMatch[1].toUpperCase()
    }

    // Property type
    const typeMatch = profileText.match(/Property Type\s+([^\n]+)/i) || profileText.match(/(R-RESIDENTIAL|SF RESIDENCE|CONDO)/i)
    if (typeMatch) result.propertyType = typeMatch[1].trim()

    // Parse values tab
    const dollarValue = (pattern: RegExp): number | undefined => {
      const m = valuesText.match(pattern)
      return m ? parseFloat(m[1].replace(/,/g, '')) : undefined
    }

    result.appraisedValue = dollarValue(/Total Market\s+\$([0-9,]+)/i)
    result.assessedValue = dollarValue(/Total Assessed\s+\$([0-9,]+)/i)
    result.landValue = dollarValue(/Total Market Land\s+\$([0-9,]+)/i)
    result.improvementValue = dollarValue(/Total Market Building\s+\$([0-9,]+)/i)

    // Parse residential tab
    const yearMatch = residentialText.match(/Year Built\s+(\d{4})/i)
    if (yearMatch) result.yearBuilt = parseInt(yearMatch[1])

    const sqftMatch = residentialText.match(/Living Area\s+([\d,]+)/i)
    if (sqftMatch) result.sqft = parseInt(sqftMatch[1].replace(/,/g, ''))

    const bedroomsMatch = residentialText.match(/Bedrooms\s+(\d+)/i)
    if (bedroomsMatch) result.bedrooms = parseInt(bedroomsMatch[1])

    const fullBathsMatch = residentialText.match(/Full Baths\s+(\d+)/i)
    if (fullBathsMatch) result.bathrooms = parseInt(fullBathsMatch[1])

    const halfBathsMatch = residentialText.match(/Half Baths\s+(\d+)/i)
    if (halfBathsMatch) result.halfBaths = parseInt(halfBathsMatch[1])

    const conditionMatch = residentialText.match(/Physical Condition\s+\d+-(\w+)/i)
    if (conditionMatch) result.condition = conditionMatch[1]

    const exteriorMatch = residentialText.match(/Exterior Wall\s+\d+-([^\n]+)/i)
    if (exteriorMatch) result.exterior = exteriorMatch[1].trim()

    const roofMatch = residentialText.match(/Roof Type\s+([A-Z]-[^\n]+)/i)
    if (roofMatch) result.roofType = roofMatch[1].trim()

    const styleMatch = residentialText.match(/Style\s+\d+-([^\n]+)/i)
    if (styleMatch) result.style = styleMatch[1].trim()

    const basementMatch = residentialText.match(/Basement\s+\d+-([^\n]+)/i)
    if (basementMatch) result.basement = basementMatch[1].trim()

    const fireplaceMatch = residentialText.match(/Fireplaces[^0-9]*(\d+)/i)
    if (fireplaceMatch) result.fireplaces = parseInt(fireplaceMatch[1])

    return result
  }

  /**
   * Jackson County, MO — Tax Collection Portal
   * Scrapes mo-jackson.publicaccessnow.com for tax delinquency data
   */
  private async enrichJacksonCountyTaxCollection(
    parid: string
  ): Promise<{
    taxOwed?: number
    taxStatus: string
    yearsDelinquent?: number
    lastPaymentDate?: string
    lastPaymentAmount?: number
    delinquentBills?: Array<{
      taxYear: number
      billNumber: string
      totalCharges: number
      totalPaid: number
      principal: number
      penalty: number
      interest: number
      status: string
    }>
    isBankruptcy?: boolean
    error?: string
  }> {
    try {
      if (!this.browser) throw new Error('Browser not initialized')
      const page = await this.browser.newPage()

      try {
        // Step 1: Load tax search page to establish session
        await page.goto('https://mo-jackson.publicaccessnow.com/Collector/TaxSearch.aspx', {
          waitUntil: 'domcontentloaded',
          timeout: this.timeout,
        })
        await page.waitForTimeout(1000)

        // Step 2: Wait for Angular to mount
        await page.waitForSelector('input[placeholder="Search..."]', { timeout: 10000 })

        // Step 3: Fill search input with PARID and press Enter
        const searchInput = page.locator('input[placeholder="Search..."]')
        await searchInput.fill(parid)
        await searchInput.press('Enter')

        // Step 4: Wait for results to load or redirect to Account.aspx
        // The site auto-redirects if there's only 1 result
        await Promise.race([
          page.waitForURL('**/Account.aspx**', { timeout: 10000 }),
          page.waitForSelector('text=View Account', { timeout: 10000 }),
        ]).catch(() => {})

        // Step 5: If on search results, click "View Account" for the matching parcel
        const currentUrl = page.url()
        if (!currentUrl.includes('Account.aspx')) {
          // Look for "View Account" link
          const viewAccountBtn = page.locator('text=View Account').first()
          if (await viewAccountBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
            await viewAccountBtn.click()
            await page.waitForURL('**/Account.aspx**', { timeout: 8000 })
          } else {
            return {
              taxStatus: 'unknown',
              error: 'Could not find property in tax collection portal',
            }
          }
        }

        // Step 6: Wait for Angular to render the account detail
        // Look for "Total Due" or "Tax Bills Due" text
        await page.waitForFunction(
          () => document.body.innerText.includes('Total Due') || document.body.innerText.includes('Tax Bills'),
          { timeout: 10000 }
        ).catch(() => {})

        // Extra wait for Angular to finish rendering
        await page.waitForTimeout(2000)

        // Step 7: Extract all text from the page
        const text = await page.evaluate(() => document.body.innerText)

        // Step 8: Parse data using regex

        // Total due
        const totalDueMatch = text.match(/Total Due:\s*\$?([\d,]+\.?\d*)/)
        const taxOwed = totalDueMatch ? parseFloat(totalDueMatch[1].replace(/,/g, '')) : 0

        // Tax status
        const isBankruptcy = text.includes('Bankruptcy')
        const hasPastDue = text.includes('Past Due')
        const taxStatus = taxOwed > 0
          ? (isBankruptcy ? 'bankruptcy' : 'delinquent')
          : 'current'

        // Years delinquent (count unique years that show up in bills section)
        const yearMatches = [...text.matchAll(/^(\d{4})\s*$/gm)]
        const uniqueYears = new Set(
          yearMatches
            .map(m => parseInt(m[1]))
            .filter(y => y >= 2000 && y <= new Date().getFullYear())
        )
        const yearsDelinquent = uniqueYears.size

        // Parse bills - look for bill blocks
        // Pattern: year on its own line, followed by bill data
        const delinquentBills: Array<{
          taxYear: number
          billNumber: string
          totalCharges: number
          totalPaid: number
          principal: number
          penalty: number
          interest: number
          status: string
        }> = []

        // Simple approach: look for dollar amounts and years
        const billSections = text.split(/\n(?=\d{4}\s*\n)/)
        for (const section of billSections) {
          const yearMatch = section.match(/^(\d{4})\s*\n/)
          if (!yearMatch) continue

          const taxYear = parseInt(yearMatch[1])
          if (taxYear < 2000 || taxYear > new Date().getFullYear()) continue

          // Extract amounts - look for patterns like "$17,700.00"
          const amounts = [...section.matchAll(/\$?([\d,]+\.\d{2})/g)].map(m =>
            parseFloat(m[1].replace(/,/g, ''))
          )

          // Determine status
          const status = section.includes('Past Due')
            ? 'Past Due'
            : (section.includes('Current') ? 'Current' : 'Unknown')

          if (amounts.length >= 4) {
            delinquentBills.push({
              taxYear,
              billNumber: '1', // Default to 1 (real estate)
              totalCharges: amounts[0] || 0,
              totalPaid: amounts[amounts.length - 1] || 0,
              principal: amounts[0] || 0,
              penalty: amounts[1] || 0,
              interest: amounts[2] || 0,
              status,
            })
          }
        }

        // Last payment (most recent date in payment history section)
        const paymentMatches = [...text.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})[^\$]*\$?([\d,]+\.\d{2})/g)]
        let lastPaymentDate: string | undefined
        let lastPaymentAmount: number | undefined

        if (paymentMatches.length > 0) {
          // Sort by date descending
          const payments = paymentMatches.map(m => ({
            date: m[1],
            amount: parseFloat(m[2].replace(/,/g, '')),
          }))
          // Take the most recent (assuming they're in chronological order in the page)
          const last = payments[payments.length - 1]
          lastPaymentDate = last.date
          lastPaymentAmount = last.amount
        }

        return {
          taxOwed: taxOwed > 0 ? taxOwed : undefined,
          taxStatus,
          yearsDelinquent: yearsDelinquent > 0 ? yearsDelinquent : undefined,
          lastPaymentDate,
          lastPaymentAmount,
          delinquentBills: delinquentBills.length > 0 ? delinquentBills : undefined,
          isBankruptcy: isBankruptcy || undefined,
        }
      } finally {
        await page.close()
      }
    } catch (err: any) {
      return {
        taxStatus: 'unknown',
        error: err.message || 'Tax collection scrape failed',
      }
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
      // Step 1: Search by situs — use full street address (house# + direction + street)
      // The API requires more than just the street name (returns "too short" error otherwise)
      // Strip only city/state/zip and suffix, keep house number and direction
      const streetOnly = input.address.split(',')[0].trim()
      const situsQuery = streetOnly
        .replace(/\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Pl|Ter|Way|Cir|Pkwy|STREET|AVENUE|BOULEVARD|DRIVE|ROAD|LANE|COURT|PLACE|TERRACE|TRAIL|CIRCLE|PARKWAY)\.?\s*$/i, '') // remove suffix
        .trim()

      const searchRes = await fetch(
        `${BASE}/parcels?situs=${encodeURIComponent(situsQuery)}`,
        { headers, signal: AbortSignal.timeout(15000) }
      )
      if (!searchRes.ok) throw new Error(`Clay search returned ${searchRes.status}`)

      let allParcels = await searchRes.json()

      // If the result is a string (error message like "too short"), try with full address
      if (typeof allParcels === 'string' || (Array.isArray(allParcels) && allParcels.length === 1 && typeof allParcels[0] === 'string')) {
        // Fallback: try with just street name (without house number)
        const fallbackQuery = situsQuery.replace(/^\d+\s+/, '').trim()
        if (fallbackQuery.length >= 4) {
          const fallbackRes = await fetch(
            `${BASE}/parcels?situs=${encodeURIComponent(fallbackQuery)}`,
            { headers, signal: AbortSignal.timeout(15000) }
          )
          allParcels = await fallbackRes.json()
        }
      }

      if (!Array.isArray(allParcels) || allParcels.length === 0 ||
          (allParcels.length === 1 && typeof allParcels[0] === 'string')) {
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

/**
 * Detect county from city, state, and zip code
 */
export function detectCounty(city?: string, state?: string, zip?: string): { county: string, state: string } | null {
  const s = state?.toUpperCase()
  const c = city?.toLowerCase()
  if (s === 'MO') {
    if (c?.includes('kansas city') || c?.includes('independence') || c?.includes('blue springs') || c?.includes('raytown') || c?.includes('grandview') || c?.includes('lee')) return { county: 'Jackson', state: 'MO' }
    if (c?.includes('liberty') || c?.includes('kearney') || c?.includes('smithville') || c?.includes('excelsior') || c?.includes('north kansas city')) return { county: 'Clay', state: 'MO' }
  }
  if (s === 'KS') {
    if (c?.includes('overland park') || c?.includes('olathe') || c?.includes('shawnee') || c?.includes('lenexa') || c?.includes('leawood') || c?.includes('prairie village') || c?.includes('merriam') || c?.includes('gardner')) return { county: 'Johnson', state: 'KS' }
    if (c?.includes('kansas city') || c?.includes('bonner springs') || c?.includes('edwardsville')) return { county: 'Wyandotte', state: 'KS' }
  }
  if (zip) {
    const z = parseInt(zip)
    if (z >= 64101 && z <= 64199) return { county: 'Jackson', state: 'MO' }
    if (z >= 66200 && z <= 66299) return { county: 'Johnson', state: 'KS' }
    if (z >= 66100 && z <= 66119) return { county: 'Wyandotte', state: 'KS' }
  }
  return null
}

/**
 * Parse a full address string to extract city, state, zip and detect county.
 * Used when forms send a single address field without separate city/state/zip.
 */
export function parseAddressForCounty(address: string): {
  city?: string; state?: string; zip?: string; county?: string;
} | null {
  if (!address) return null

  let city: string | undefined
  let state: string | undefined
  let zip: string | undefined

  // Match "City, ST 12345" or "City ST 12345" at end of address
  const fullMatch = address.match(/,?\s*([A-Za-z\s]+?),?\s*(MO|KS|mo|ks)\s*(\d{5})?\s*$/)
  if (fullMatch) {
    city = fullMatch[1]?.trim()
    state = fullMatch[2]?.toUpperCase()
    zip = fullMatch[3]
  } else {
    const zipMatch = address.match(/(\d{5})\s*$/)
    if (zipMatch) zip = zipMatch[1]
    const stateMatch = address.match(/\b(MO|KS)\b/i)
    if (stateMatch) state = stateMatch[1].toUpperCase()
  }

  // Fallback: detect known KC metro city names embedded in address
  if (!city) {
    const knownCities = [
      'kansas city', 'independence', 'blue springs', 'raytown',
      'grandview', 'liberty', 'kearney', 'smithville', 'excelsior springs',
      'north kansas city', 'overland park', 'olathe', 'shawnee',
      'lenexa', 'leawood', 'prairie village', 'merriam', 'gardner',
      'bonner springs', 'edwardsville', "lee's summit", 'lees summit',
      'gladstone', 'belton', 'raymore', 'peculiar', 'pleasant hill',
    ]
    const lower = address.toLowerCase()
    for (const c of knownCities) {
      if (lower.includes(c)) { city = c; break }
    }
  }

  const detected = detectCounty(city, state, zip)
  return { city, state: state || detected?.state, zip, county: detected?.county }
}
