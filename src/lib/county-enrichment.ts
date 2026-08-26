// County Property Enrichment Service
// Queries county assessor systems for property data

import type { Browser } from 'playwright'
import { supabase as supabaseCache } from '@/lib/supabase-lazy'
import type {
  CountyApiRecord,
  EnrichmentRawData,
  JacksonCountyData,
  JacksonCountyTaxData,
  PlatteDwelling,
  PlatteValuation,
} from '@/lib/county-enrichment-types'

export interface EnrichmentInput {
  address: string
  city?: string
  state: string
  zip?: string
  county: string
  /** Optional pre-known parcel id — when provided, Jackson/Clay scrapers
   * skip the flaky address-search step and go straight to the parcel record.
   * Populated by the reprocess pipeline from prospect_phones matches. */
  parcel_id?: string
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
  basementType?: string
  latestTaxAmount?: number
  source?: string
  fetchedAt?: string
  error?: string
  rawData?: EnrichmentRawData
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/**
 * Convert HTML to plain text approximating browser innerText.
 * Used by fetch-based scrapers that can't run JavaScript.
 */
function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|tr|li|h[1-6]|td|th|section|header|footer)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export class CountyEnrichmentService {
  private browser: Browser | null = null
  private readonly timeout = 30000

  async init() {
    try {
      const { chromium } = await import('playwright')
      this.browser = await chromium.launch({ headless: true, timeout: this.timeout })
    } catch {
      // Playwright not available (e.g. Vercel serverless) — browser-based counties will fail gracefully
      this.browser = null
    }
  }

  async close() {
    if (this.browser) {
      await this.browser.close()
      this.browser = null
    }
  }

  /**
   * Main enrichment router — checks property_cache first, falls back to scraper.
   * Pass forceRefresh=true to bypass cache (e.g. manual re-enrichment).
   */
  async enrich(input: EnrichmentInput, forceRefresh = false): Promise<EnrichmentResult> {
    const cacheKey = `${input.county.toLowerCase()}:${input.address.toLowerCase().trim()}`

    // Cache check (skip on forceRefresh)
    if (!forceRefresh) {
      try {
        const { data: cached } = await supabaseCache
          .from('property_cache')
          .select('data')
          .eq('cache_key', cacheKey)
          .gt('expires_at', new Date().toISOString())
          .limit(1)
          .single()

        if (cached?.data) {
          console.log(`[enrichment] Cache hit for ${cacheKey}`)
          return cached.data as EnrichmentResult
        }
      } catch {
        // Cache miss or table not yet created — proceed to scraper
      }
    }

    // Cache miss — run scraper
    const result = await this.enrichFromCounty(input)

    // Write to cache (fire-and-forget — don't block the caller)
    if (result.success) {
      void supabaseCache
        .from('property_cache')
        .upsert({
          cache_key: cacheKey,
          county: input.county,
          address: input.address,
          parcel_id: result.parcelId ?? null,
          data: result,
          source: result.source ?? `${input.county.toLowerCase()}_county`,
          fetched_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        }, { onConflict: 'cache_key' })
        .then(({ error }) => {
          if (error) console.warn(`[enrichment] Cache write failed for ${cacheKey}:`, error.message)
          else console.log(`[enrichment] Cached result for ${cacheKey}`)
        })
    }

    return result
  }

  /**
   * Internal: routes to the correct county scraper.
   */
  private async enrichFromCounty(input: EnrichmentInput): Promise<EnrichmentResult> {
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
      } else if (state === 'MO' && county === 'platte') {
        return await this.enrichPlatteCountyMO(input)
      } else {
        return {
          success: false,
          county: input.county,
          error: `County not supported: ${county}, ${state}`,
        }
      }
    } catch (err: unknown) {
      return {
        success: false,
        county: input.county,
        error: errorMessage(err, 'Enrichment failed'),
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
            const dollarVal = (label: string): number | undefined => {
              const m = html.match(new RegExp(label + '[^$]*\\$([\\d,]+\\.\\d{2})', 'i'))
              return m ? parseFloat(m[1].replace(/,/g, '')) : undefined
            }
            currentAmountDue = dollarVal('Current Amount Due')
            pastYearsDue = dollarVal('Past Years Due')
            taxOwed = dollarVal('Total Due')
          }
        } catch {
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
        } catch {
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
    } catch (err: unknown) {
      return { success: false, county: 'Johnson', error: errorMessage(err, 'Johnson County enrichment failed') }
    }
  }

  /**
   * Jackson County, MO — fetch-based iasWorld scraper (no Playwright)
   * Maintains ASP.NET session cookies through: disclaimer → search → datalet tabs
   */
  private async enrichJacksonCountyMO(
    input: EnrichmentInput
  ): Promise<EnrichmentResult> {
    const BASE = 'https://publicaccess.jacksongov.org'
    const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    const cookies: Record<string, string> = {}

    // Merge Set-Cookie headers into the cookie jar
    const mergeCookies = (res: Response) => {
      const headers = res.headers as Headers & { getSetCookie?: () => string[] }
      const setCookies: string[] = typeof headers.getSetCookie === 'function'
        ? headers.getSetCookie()
        : res.headers.get('set-cookie') ? [res.headers.get('set-cookie')!] : []
      for (const c of setCookies) {
        const [kv] = c.split(';')
        const eq = kv.indexOf('=')
        if (eq > 0) cookies[kv.slice(0, eq).trim()] = kv.slice(eq + 1).trim()
      }
    }

    const cookieHeader = () => Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ')

    const get = (url: string, referer?: string) =>
      fetch(url, {
        headers: { 'User-Agent': UA, Cookie: cookieHeader(), ...(referer ? { Referer: referer } : {}) },
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
      })

    const post = (url: string, body: URLSearchParams, referer: string) =>
      fetch(url, {
        method: 'POST',
        headers: {
          'User-Agent': UA,
          Cookie: cookieHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
          Referer: referer,
        },
        body: body.toString(),
        redirect: 'follow',
        signal: AbortSignal.timeout(25000),
      })

    const extractViewState = (html: string): Record<string, string> => {
      const fields: Record<string, string> = {}
      for (const f of ['__VIEWSTATE', '__VIEWSTATEGENERATOR', '__EVENTVALIDATION']) {
        const m = html.match(new RegExp(`name="${f}"[^>]*value="([^"]*)"`, 'i'))
          ?? html.match(new RegExp(`id="${f}"[^>]*value="([^"]*)"`, 'i'))
        if (m) fields[f] = m[1]
      }
      return fields
    }

    try {
      // Step 1: GET disclaimer page — establishes ASP.NET_SessionId
      const disclaimerUrl = `${BASE}/Search/Disclaimer.aspx?FromUrl=../search/commonsearch.aspx?mode=realprop`
      const r1 = await get(disclaimerUrl)
      mergeCookies(r1)
      const html1 = await r1.text()
      const vs1 = extractViewState(html1)

      // Step 2: POST disclaimer acceptance — sets DISCLAIMER cookie
      const r2 = await post(
        disclaimerUrl,
        new URLSearchParams({ ...vs1, '__EVENTTARGET': '', '__EVENTARGUMENT': '', 'btAgree': 'I Agree' }),
        disclaimerUrl
      )
      mergeCookies(r2)
      await r2.text() // consume body

      // Step 3: GET real property search page — extract ViewState for search form
      const searchUrl = `${BASE}/search/commonsearch.aspx?mode=realprop`
      const r3 = await get(searchUrl, BASE)
      mergeCookies(r3)
      const html3 = await r3.text()
      const vs3 = extractViewState(html3)

      // Step 4: POST search — prefer parcel_id when we have one (dramatically
      // more reliable than the flaky address search). Fall back to address.
      let r4: Response
      if (input.parcel_id) {
        // iasWorld supports direct parcel search via inpParid field.
        // Normalize: strip hyphens/spaces.
        const paridClean = input.parcel_id.replace(/[-\s]/g, '')
        r4 = await post(
          searchUrl,
          new URLSearchParams({
            ...vs3,
            '__EVENTTARGET': '', '__EVENTARGUMENT': '',
            'inpParid': paridClean,
            'btSearch': 'Search',
          }),
          searchUrl,
        )
      } else {
        const { houseNumber, streetName, suffix } = this.parseJacksonAddress(input.address)
        r4 = await post(
          searchUrl,
          new URLSearchParams({
            ...vs3,
            '__EVENTTARGET': '', '__EVENTARGUMENT': '',
            'inpNo': houseNumber,
            'inpStreet': streetName.toUpperCase(),
            'inpSuf': suffix,
            'inpDirPrefix': '',
            'inpDirSuffix': '',
            'btSearch': 'Search',
          }),
          searchUrl,
        )
      }
      mergeCookies(r4)
      let html4 = await r4.text()

      if (html4.includes('did not find any records') || html4.includes('No records found')) {
        return { success: false, county: 'Jackson', error: 'Address not found in Jackson County records' }
      }

      // Step 5: If on a results list (not auto-redirected to a datalet), follow first datalet link
      const onDatalet = r4.url.includes('/Datalets/') || r4.url.includes('/datalets/')
      if (!onDatalet) {
        // iasWorld renders datalet links as href="../Datalets/Datalet.aspx?..."
        const hrefMatch = html4.match(/href="([^"]*[Dd]atalet\.aspx[^"]*)"/)
        if (!hrefMatch) {
          return { success: false, county: 'Jackson', error: 'No property record found in search results' }
        }
        const href = hrefMatch[1].replace(/&amp;/g, '&')
        const destUrl = href.startsWith('http') ? href : `${BASE}/${href.replace(/^\.\.\//, '').replace(/^\//, '')}`
        const r5 = await get(destUrl, r4.url)
        mergeCookies(r5)
        html4 = await r5.text() // profile data is on this datalet landing page
      }

      // Profile text from the current datalet page (equivalent to .WidgetBar innerText)
      const profileText = htmlToText(html4)

      // Step 6: Values tab — session holds the current parcel via sIndex/idx
      const rValues = await get(
        `${BASE}/datalets/datalet.aspx?mode=valuesall&sIndex=0&idx=1&LMparent=20`,
        r4.url
      )
      const valuesText = htmlToText(await rValues.text())

      // Step 7: Residential tab — try residential → profileall → oby and
      // merge results. iasWorld stores building-card data on different tabs
      // depending on parcel class; the external jackson-county-parcel-scraper
      // repo walks all three to cover the matrix.
      let residentialText = ''
      let cardText = ''
      let referer = `${BASE}/datalets/datalet.aspx?mode=valuesall&sIndex=0&idx=1&LMparent=20`
      for (const mode of ['residential', 'profileall', 'oby']) {
        try {
          const r = await get(
            `${BASE}/datalets/datalet.aspx?mode=${mode}&sIndex=0&idx=1&LMparent=20`,
            referer,
          )
          const text = htmlToText(await r.text())
          // Keep the original 'residential' text for backward-compat regex parsing,
          // and append other modes into a combined 'cardText' string which the
          // parser also inspects for bedroom/sqft/year fields.
          if (mode === 'residential') {
            residentialText = text
          }
          cardText += '\n' + text
          referer = `${BASE}/datalets/datalet.aspx?mode=${mode}&sIndex=0&idx=1&LMparent=20`
        } catch (tabErr) {
          // Continue — not all tabs exist for every parcel
          console.warn(`[Jackson] tab ${mode} failed:`, errorMessage(tabErr, 'Unknown tab error'))
        }
      }

      // Step 8: Parse — pass combined cardText so parser can check across modes
      const parsed = this.parseJacksonCountyData(profileText, valuesText, residentialText + '\n' + cardText)

      // Step 9: Tax collection data (best-effort, non-blocking)
      let taxData: Partial<JacksonCountyTaxData> = {}
      if (parsed.paridFormatted) {
        taxData = await this.enrichJacksonCountyTaxCollection()
      }

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
    } catch (err: unknown) {
      return { success: false, county: 'Jackson', error: errorMessage(err, 'Jackson County enrichment failed') }
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
    const streetOnly = address.split(',')[0].trim()

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
  ): JacksonCountyData {
    const result: JacksonCountyData = {}

    // Parse profile data
    const paridMatch = profileText.match(/PARID:\s*([\d]+)/i)
    if (paridMatch) result.paridFormatted = paridMatch[1]

    // Owner name — usually at top of profile
    const ownerMatch = profileText.match(/\n([A-Z][A-Z\s&,.']+)\n/m)
    if (ownerMatch) result.ownerName = ownerMatch[1].trim()

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

    // Parse residential/card tab — try multiple label variants (Jackson County
    // iasWorld uses different labels on residential vs profileall vs oby tabs;
    // mirrors the external jackson-county-parcel-scraper repo's fallback set).
    const firstMatch = (text: string, patterns: RegExp[]): string | null => {
      for (const p of patterns) {
        const m = text.match(p)
        if (m) return m[1]
      }
      return null
    }

    const yearStr = firstMatch(residentialText, [
      /Year Built\s+(\d{4})/i,
      /Eff(?:ective)?\s*Year\s*Built\s+(\d{4})/i,
    ])
    if (yearStr) result.yearBuilt = parseInt(yearStr)

    const sqftStr = firstMatch(residentialText, [
      /Living\s*Area\s+([\d,]+)/i,
      /Total\s*Living\s*Area\s+([\d,]+)/i,
      /Finished\s*Sq(?:uare)?\s*Ft\.?\s+([\d,]+)/i,
    ])
    if (sqftStr) result.sqft = parseInt(sqftStr.replace(/,/g, ''))

    const bedsStr = firstMatch(residentialText, [
      /Bedrooms\s+(\d+)/i,
      /Total\s*Bedrooms\s+(\d+)/i,
      /No\.?\s*Bedrooms\s+(\d+)/i,
    ])
    if (bedsStr) result.bedrooms = parseInt(bedsStr)

    const fullBathStr = firstMatch(residentialText, [
      /Full\s*Baths?\s+(\d+)/i,
      /Baths\s+(\d+)/i,
      /Bathrooms\s+(\d+)/i,
    ])
    if (fullBathStr) result.bathrooms = parseInt(fullBathStr)

    const halfBathStr = firstMatch(residentialText, [
      /Half\s*Baths?\s+(\d+)/i,
    ])
    if (halfBathStr) result.halfBaths = parseInt(halfBathStr)

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
   * mo-jackson.publicaccessnow.com is an Angular SPA; we try ScraperAPI (render=true)
   * if SCRAPER_API_KEY is set, otherwise return unknown gracefully.
   */
  private async enrichJacksonCountyTaxCollection(): Promise<JacksonCountyTaxData> {
    const parseTaxText = (text: string) => {
      const totalDueMatch = text.match(/Total Due:\s*\$?([\d,]+\.?\d*)/)
      const taxOwed = totalDueMatch ? parseFloat(totalDueMatch[1].replace(/,/g, '')) : 0
      const isBankruptcy = text.includes('Bankruptcy')
      const taxStatus = taxOwed > 0 ? (isBankruptcy ? 'bankruptcy' : 'delinquent') : 'current'

      const yearMatches = [...text.matchAll(/^(\d{4})\s*$/gm)]
      const uniqueYears = new Set(
        yearMatches.map(m => parseInt(m[1])).filter(y => y >= 2000 && y <= new Date().getFullYear())
      )
      const yearsDelinquent = uniqueYears.size

      const delinquentBills: Array<{
        taxYear: number; billNumber: string; totalCharges: number; totalPaid: number
        principal: number; penalty: number; interest: number; status: string
      }> = []
      for (const section of text.split(/\n(?=\d{4}\s*\n)/)) {
        const yearMatch = section.match(/^(\d{4})\s*\n/)
        if (!yearMatch) continue
        const taxYear = parseInt(yearMatch[1])
        if (taxYear < 2000 || taxYear > new Date().getFullYear()) continue
        const amounts = [...section.matchAll(/\$?([\d,]+\.\d{2})/g)].map(m =>
          parseFloat(m[1].replace(/,/g, ''))
        )
        const status = section.includes('Past Due') ? 'Past Due' : section.includes('Current') ? 'Current' : 'Unknown'
        if (amounts.length >= 4) {
          delinquentBills.push({
            taxYear, billNumber: '1',
            totalCharges: amounts[0] || 0, totalPaid: amounts[amounts.length - 1] || 0,
            principal: amounts[0] || 0, penalty: amounts[1] || 0, interest: amounts[2] || 0, status,
          })
        }
      }

      const paymentMatches = [...text.matchAll(/(\d{1,2}\/\d{1,2}\/\d{4})[^$]*\$?([\d,]+\.\d{2})/g)]
      let lastPaymentDate: string | undefined
      let lastPaymentAmount: number | undefined
      if (paymentMatches.length > 0) {
        const last = paymentMatches[paymentMatches.length - 1]
        lastPaymentDate = last[1]
        lastPaymentAmount = parseFloat(last[2].replace(/,/g, ''))
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
    }

    const scraperApiKey = process.env.SCRAPER_API_KEY
    if (!scraperApiKey) {
      return { taxStatus: 'unknown', error: 'Tax portal is a JS SPA — set SCRAPER_API_KEY to enable' }
    }

    try {
      // publicaccessnow.com Angular app — use ScraperAPI with JS rendering
      // The app auto-redirects to Account.aspx when a single parcel matches; try direct deep-link first
      const accountUrl = `https://mo-jackson.publicaccessnow.com/Collector/TaxSearch.aspx`
      const scraperUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(accountUrl)}&render=true&country_code=us&wait=4000`

      const res = await fetch(scraperUrl, { signal: AbortSignal.timeout(90000) })
      if (!res.ok) throw new Error(`ScraperAPI returned ${res.status}`)

      const html = await res.text()
      const text = htmlToText(html)

      if (!text.includes('Total Due') && !text.includes('Tax Bills')) {
        return { taxStatus: 'unknown', error: 'Tax portal did not return account data' }
      }

      return parseTaxText(text)
    } catch (err: unknown) {
      return { taxStatus: 'unknown', error: errorMessage(err, 'Tax collection lookup failed') }
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
    } catch (err: unknown) {
      return {
        success: false,
        county: 'Wyandotte',
        error: errorMessage(err, 'Wyandotte County enrichment failed'),
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
      // Step 1: Search by situs. Clay's /parcels endpoint is picky — it matches
      // a substring against the raw situs string ("729 LAUREL AVE LIBERTY MO"),
      // so any extra word not present (or a trailing city that IS present but
      // at the wrong position) returns []. Strategy: try several progressively
      // looser queries until one returns results.
      const streetOnly = input.address.split(',')[0].trim()
      const suffixRe = /\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Pl|Ter|Way|Cir|Pkwy|STREET|AVENUE|BOULEVARD|DRIVE|ROAD|LANE|COURT|PLACE|TERRACE|TRAIL|CIRCLE|PARKWAY)\b\.?/i
      const clayCities = /\b(Liberty|Kearney|Smithville|Excelsior\s+Springs|Gladstone|Pleasant\s+Valley|North\s+Kansas\s+City|Claycomo|Randolph|Oakview)\b/i

      const queries: string[] = []
      // (a) Full street-only (may include city at end — fine if it's in the situs string)
      queries.push(streetOnly)
      // (b) Strip trailing city name (e.g. "729 LAUREL AVE LIBERTY" → "729 LAUREL AVE")
      const noCitySuffix = streetOnly.replace(clayCities, '').replace(/\s{2,}/g, ' ').trim()
      if (noCitySuffix !== streetOnly) queries.push(noCitySuffix)
      // (c) Truncate at (and through) the street suffix — "729 LAUREL AVE LIBERTY" → "729 LAUREL"
      const suffixIdx = streetOnly.search(suffixRe)
      if (suffixIdx > 0) queries.push(streetOnly.slice(0, suffixIdx).trim())
      // (d) Drop the suffix only, keep the rest — "729 LAUREL AVE LIBERTY" → "729 LAUREL LIBERTY" (rarely helps but cheap)
      const noSuffix = streetOnly.replace(suffixRe, ' ').replace(/\s{2,}/g, ' ').trim()
      if (noSuffix && !queries.includes(noSuffix)) queries.push(noSuffix)
      // (e) House number + first 2 tokens of street name (fallback) — "729 LAUREL"
      const tokens = streetOnly.split(/\s+/)
      if (tokens.length >= 2) {
        const short = tokens.slice(0, 2).join(' ')
        if (short && !queries.includes(short)) queries.push(short)
      }

      let allParcels: CountyApiRecord[] = []
      for (const q of queries) {
        if (!q || q.length < 3) continue
        try {
          const res = await fetch(
            `${BASE}/parcels?situs=${encodeURIComponent(q)}`,
            { headers, signal: AbortSignal.timeout(15000) },
          )
          if (!res.ok) continue
          const json: unknown = await res.json()
          if (Array.isArray(json) && json.length > 0 && typeof json[0] !== 'string') {
            allParcels = json as CountyApiRecord[]
            break
          }
        } catch { /* try next */ }
      }

      if (!Array.isArray(allParcels) || allParcels.length === 0) {
        return { success: false, county: 'Clay', error: 'Address not found in Clay County records' }
      }

      // Match by house number
      const houseNum = input.address.match(/^(\d+)/)?.[1] || ''
      const parcel = allParcels.find((p) =>
        p.situs && houseNum && p.situs.toString().startsWith(houseNum)
      ) || allParcels[0]
      const propId = parcel.prop_id
      if (!propId) throw new Error('No prop_id returned from Clay County search')

      // Determine 14-digit collector parcel number (may be in parcel_id / parcelid field)
      const rawParcelId = (parcel.parcel_id || parcel.parcelid || '').toString().replace(/[-\s]/g, '')
      const is14Digit = /^\d{14}$/.test(rawParcelId)

      // Step 2: Fetch detail, dwelling, value, AND tax collection in parallel
      const taxCollectionPromise = (async () => {
        let p14 = is14Digit ? rawParcelId : null
        if (!p14) {
          // Fall back to collector address search to find the 14-digit parcel
          p14 = await this.getClayCollectorParcelNumber(input.address).catch(() => null)
        }
        if (!p14) return null
        return this.enrichClayCountyTaxCollection(p14)
      })().catch(err => {
        console.warn('[Clay] Tax collection failed (continuing):', err.message)
        return null
      })

      const [detailRes, dwellingRes, valueRes, taxData] = await Promise.all([
        fetch(`${BASE}/parcel/${propId}`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${BASE}/parcel/${propId}/dwelling`, { headers, signal: AbortSignal.timeout(10000) }),
        fetch(`${BASE}/parcel/${propId}/value`, { headers, signal: AbortSignal.timeout(10000) }),
        taxCollectionPromise,
      ])

      const detail = detailRes.ok ? await detailRes.json() as CountyApiRecord | CountyApiRecord[] : []
      const dwelling = dwellingRes.ok ? await dwellingRes.json() as CountyApiRecord | CountyApiRecord[] : []
      const value = valueRes.ok ? await valueRes.json() as CountyApiRecord | CountyApiRecord[] : []

      const d = Array.isArray(detail) ? detail[0] || {} : detail
      const dw = Array.isArray(dwelling) ? dwelling[0] || {} : dwelling
      const v = Array.isArray(value)
        ? (value.find((entry) => entry.val_yr === 'current year') || value[0] || {})
        : value

      const mailingAddress = [d.owner_street, d.owner_city, d.owner_state, d.owner_zip]
        .filter(Boolean).join(', ')

      return {
        success: true,
        county: 'Clay',
        parcelId: is14Digit ? rawParcelId : (parcel.parcel_id || parcel.parcelid || undefined),
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
        taxOwed: taxData?.totalOwed || undefined,
        taxStatus: taxData?.taxStatus || undefined,
        source: 'clay_county_assessor',
        fetchedAt: new Date().toISOString(),
        rawData: {
          parcel, detail: d, dwelling: dw, value: v,
          taxCollection: taxData || null,
          // Fields auto-enrich.ts maps to manifest.property.taxCollector:
          numYearsPastDue: taxData?.yearsDelinquent,
          taxYearsPastDue: taxData?.delinquentYears,
          currentAmountDue: taxData?.currentAmountDue,
          pastYearsDue: taxData?.pastYearsDue,
        },
      }
    } catch (err: unknown) {
      return { success: false, county: 'Clay', error: errorMessage(err, 'Clay County enrichment failed') }
    }
  }

  /**
   * Clay County, MO — Tax Collection Portal
   * Queries collector.claycountymo.gov installments API for delinquency data.
   * Requires the 14-digit parcel number (distinct from assessor prop_id).
   */
  private async enrichClayCountyTaxCollection(parcelNumber: string): Promise<{
    totalOwed: number
    taxStatus: string
    yearsDelinquent: number
    delinquentYears: string
    currentAmountDue: number
    pastYearsDue: number
    error?: string
  }> {
    const today = new Date()
    const todayStr = `${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}-${today.getFullYear()}`
    const currentYear = today.getFullYear()
    // Check the 3 most recent tax years (taxes are assessed for prior year)
    const yearsToCheck = [currentYear - 1, currentYear - 2, currentYear - 3]
    const collectorHeaders = {
      Referer: 'https://collector.claycountymo.gov/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'application/json',
    }

    const yearResults = await Promise.allSettled(
      yearsToCheck.map(async (year) => {
        const url = `https://collector.claycountymo.gov/api/installments.php?parcel_number=${parcelNumber}&tax_year=${year}&interest_date=${todayStr}`
        const res = await fetch(url, { headers: collectorHeaders, signal: AbortSignal.timeout(15000) })
        if (!res.ok) throw new Error(`Collector API returned ${res.status} for year ${year}`)
        const json = await res.json()
        return { year, json }
      })
    )

    let totalOwed = 0
    let currentAmountDue = 0
    let pastYearsDue = 0
    const delinquentYearsList: number[] = []

    for (const result of yearResults) {
      if (result.status !== 'fulfilled') continue
      const { year, json } = result.value
      if (!json.success || json.data?.no_charges_due) continue
      const balance = typeof json.data?.balance_amount === 'number' ? json.data.balance_amount : 0
      if (balance > 0) {
        totalOwed += balance
        delinquentYearsList.push(year)
        // Most recent tax year = current amount due; older = past years due
        if (year === currentYear - 1) {
          currentAmountDue = balance
        } else {
          pastYearsDue += balance
        }
      }
    }

    return {
      totalOwed,
      taxStatus: totalOwed > 0 ? 'delinquent' : 'current',
      yearsDelinquent: delinquentYearsList.length,
      delinquentYears: delinquentYearsList.sort((a, b) => a - b).join(','),
      currentAmountDue,
      pastYearsDue,
    }
  }

  /**
   * Clay County, MO — Collector address search
   * Used when the assessor parcel_id is not in 14-digit collector format.
   * POST to collector search, parse parcel-link href for 14-digit parcel number.
   */
  private async getClayCollectorParcelNumber(address: string): Promise<string | null> {
    const streetOnly = address.split(',')[0].trim()
    const formData = new URLSearchParams({
      mode: 'address',
      line1: `%${streetOnly}%`,
      action: 'search',
    })

    const res = await fetch('https://collector.claycountymo.gov/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Referer: 'https://collector.claycountymo.gov/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      },
      body: formData.toString(),
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return null

    const html = await res.text()
    // parcel-link elements contain the 14-digit parcel number in the href or text
    const m =
      html.match(/class="parcel-link"[^>]*href="[^"]*[?&]parcel[_=](\d{14})[^"]*"/) ||
      html.match(/href="[^"]*[?&]parcel_number=(\d{14})[^"]*"/) ||
      html.match(/parcel-link[^>]*>[\s]*(\d{14})[\s]*</) ||
      html.match(/(\d{14})/)  // fallback: first 14-digit sequence in page
    return m?.[1] || null
  }

  /**
   * Platte County, MO — Cascade: Collector (address search + tax) → Beacon (dwelling + assessment)
   * 1. Search plattecountycollector.com by street address to find parcel ID + tax history
   * 2. Use parcel ID on beacon.schneidercorp.com for dwelling details + valuation
   */
  private async enrichPlatteCountyMO(
    input: EnrichmentInput
  ): Promise<EnrichmentResult> {
    if (!this.browser) throw new Error('Browser not initialized')
    const page = await this.browser.newContext({ ignoreHTTPSErrors: true }).then(ctx => ctx.newPage())

    try {
      // === STAGE 1: Collector — search by address, get parcel ID + tax data ===

      // Build search query: strip city/state/zip, keep house# + direction + street name, drop suffix
      const streetOnly = input.address.split(',')[0].trim()
      const searchQuery = streetOnly
        .replace(/\s+(St|Ave|Blvd|Dr|Rd|Ln|Ct|Pl|Ter|Way|Cir|Pkwy|STREET|AVENUE|BOULEVARD|DRIVE|ROAD|LANE|COURT|PLACE|TERRACE|TRAIL|CIRCLE|PARKWAY)\.?\s*$/i, '')
        .trim()

      // Navigate to collector search
      await page.goto('https://plattecountycollector.com/realsearch.php', {
        waitUntil: 'domcontentloaded', timeout: this.timeout
      })
      await page.waitForTimeout(500)

      // Fill street name field and submit (3rd submit button on page)
      await page.locator('input[name="strtname"]').fill(searchQuery)
      const submitBtns = page.locator('input[type="submit"]')
      const btnCount = await submitBtns.count()
      if (btnCount >= 3) {
        await submitBtns.nth(2).click()
      } else {
        await page.locator('input[name="strtname"]').press('Enter')
      }
      await page.waitForTimeout(3000)

      // Extract parcel ID from results table
      // Table columns: [checkbox, Parcel, Name, Mailing, Physical, Subdivision]
      const searchResult = await page.evaluate((houseNum) => {
        const rows = Array.from(document.querySelectorAll('tr'))
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td')) as HTMLElement[]
          if (cells.length >= 5) {
            const parcel = cells[1]?.innerText?.trim() || ''
            const owner = cells[2]?.innerText?.trim() || ''
            const physical = cells[4]?.innerText?.trim() || ''
            // Match by house number if provided
            if (houseNum && physical.startsWith(houseNum)) {
              return { parcelId: parcel, address: physical, owner }
            }
            // Return first result with valid parcel ID format
            if (parcel.match(/^\d+-/)) {
              return { parcelId: parcel, address: physical, owner }
            }
          }
        }
        return null
      }, input.address.match(/^(\d+)/)?.[1] || '')

      if (!searchResult?.parcelId) {
        return { success: false, county: 'Platte', error: 'Address not found in Platte County records' }
      }

      const parcelId = searchResult.parcelId

      // Navigate to collector detail page for tax data
      await page.goto(
        `https://plattecountycollector.com/realview.php?user=beacon&pid=${encodeURIComponent(parcelId)}`,
        { waitUntil: 'domcontentloaded', timeout: this.timeout }
      )
      await page.waitForTimeout(2000)

      // Extract tax payment history
      const taxData = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('tr'))
        const taxRows: { year: number; amount: number; paid: boolean; datePaid: string }[] = []
        for (const row of rows) {
          const cells = Array.from(row.querySelectorAll('td'))
          if (cells.length >= 5) {
            const year = parseInt(cells[0]?.innerText?.trim())
            const amountText = cells[2]?.innerText?.trim().replace(/[$ ,]/g, '')
            const datePaid = cells[4]?.innerText?.trim()
            if (year > 2000 && amountText) {
              taxRows.push({
                year,
                amount: parseFloat(amountText),
                paid: !!datePaid && datePaid.length > 3,
                datePaid: datePaid || ''
              })
            }
          }
        }
        return taxRows
      })

      // Calculate delinquency
      const unpaidYears = taxData.filter(t => !t.paid)
      const totalOwed = unpaidYears.reduce((sum, t) => sum + t.amount, 0)
      const latestTax = taxData.length > 0 ? taxData[0].amount : undefined

      // === STAGE 2: Beacon — dwelling details + valuation ===
      // Uses ScraperAPI or ZenRows to bypass Cloudflare Turnstile on Beacon
      // Set SCRAPER_API_KEY env var to enable (sign up free at scraperapi.com or zenrows.com)

      let dwelling: PlatteDwelling = {}
      let valuation: PlatteValuation = {}

      const scraperApiKey = process.env.SCRAPER_API_KEY
      const beaconUrl = `https://beacon.schneidercorp.com/Application.aspx?AppID=589&LayerID=17697&PageTypeID=4&PageID=7914&KeyValue=${encodeURIComponent(parcelId)}`

      if (scraperApiKey) {
        try {
          // ScraperAPI: renders JS + bypasses Cloudflare
          const scraperUrl = `https://api.scraperapi.com?api_key=${scraperApiKey}&url=${encodeURIComponent(beaconUrl)}&render=true&country_code=us`

          const res = await fetch(scraperUrl, { signal: AbortSignal.timeout(90000) })
          if (!res.ok) throw new Error(`ScraperAPI returned ${res.status}`)

          const html = await res.text()

          // Check if we got real Beacon data (not a Cloudflare page)
          if (html.includes('Year Built') || html.includes('Gross Living Area')) {
            // Parse th/td pairs from HTML (Beacon uses <th>Label</th><td>Value</td>)
            // th may contain nested <strong> or <span> tags
            const thTdPattern = /<th[^>]*>([\s\S]*?)<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/gi
            const fields: Record<string, string> = {}
            let match
            while ((match = thTdPattern.exec(html)) !== null) {
              const label = match[1].replace(/<[^>]*>/g, '').trim()
              const value = match[2].replace(/<[^>]*>/g, '').trim()
              if (label && value) fields[label] = value
            }

            dwelling = {
              yearBuilt: fields['Year Built'] || '',
              grossLivingArea: fields['Gross Living Area'] || '',
              style: fields['Style'] || '',
              bedrooms: fields['Number of Bedrooms'] || '',
              basement: fields['Basement Area Type'] || '',
              basementArea: fields['Basement Area'] || '',
              heat: fields['Heat'] || '',
              centralAir: fields['Central Air'] || '',
              bathrooms: fields['Plumbing'] || '',
              lotArea: fields['Lot Area'] || '',
            }

            // Parse valuation table
            const residentialMatch = html.replace(/\n/g, ' ').match(/Residential Value.*?\$([\d,]+\.?\d*).*?\$([\d,]+\.?\d*).*?\$([\d,]+\.?\d*).*?\$([\d,]+\.?\d*)/)
            if (residentialMatch) {
              valuation = {
                improvements: parseFloat(residentialMatch[1].replace(/,/g, '')) || 0,
                land: parseFloat(residentialMatch[2].replace(/,/g, '')) || 0,
                total: parseFloat(residentialMatch[3].replace(/,/g, '')) || 0,
                assessed: parseFloat(residentialMatch[4].replace(/,/g, '')) || 0,
              }
            }

            console.log('[Platte] Beacon data retrieved via ScraperAPI')
          } else {
            console.warn('[Platte] ScraperAPI returned page without property data')
          }
        } catch (scraperErr: unknown) {
          console.warn('[Platte] ScraperAPI failed (continuing with collector data):', errorMessage(scraperErr, 'Unknown scraper error'))
        }
      } else {
        console.log('[Platte] No SCRAPER_API_KEY set — skipping Beacon dwelling data')
      }

      await page.close()

      // Parse dwelling fields
      const sqftMatch = dwelling.grossLivingArea?.match(/(\d[\d,]+)/)
      const sqft = sqftMatch ? parseInt(sqftMatch[1].replace(/,/g, '')) : undefined
      const yearBuilt = dwelling.yearBuilt ? parseInt(dwelling.yearBuilt) : undefined
      const bedroomsMatch = dwelling.bedrooms?.match(/(\d+)\s*above/)
      const bedrooms = bedroomsMatch ? parseInt(bedroomsMatch[1]) : undefined
      const bathMatch = dwelling.bathrooms?.match(/(\d+)\s*Standard Bath/)
      const bathrooms = bathMatch ? parseInt(bathMatch[1]) : undefined
      return {
        success: true,
        county: 'Platte',
        source: 'platte_county_collector_beacon',
        // Assessment from Beacon
        appraisedValue: valuation.total || undefined,
        landValue: valuation.land || undefined,
        improvementValue: valuation.improvements || undefined,
        assessedValue: valuation.assessed || undefined,
        // Dwelling from Beacon
        sqft,
        yearBuilt,
        bedrooms,
        bathrooms,
        propertyType: dwelling.style || undefined,
        basementType: dwelling.basement || undefined,
        // Tax from Collector
        taxOwed: totalOwed > 0 ? totalOwed : undefined,
        taxStatus: unpaidYears.length > 0 ? 'delinquent' : 'current',
        latestTaxAmount: latestTax,
        // Parcel
        parcelId,
        ownerName: searchResult.owner || undefined,
        fetchedAt: new Date().toISOString(),
      }
    } catch (err: unknown) {
      await page.close().catch(() => {})
      return { success: false, county: 'Platte', error: errorMessage(err, 'Platte County enrichment failed') }
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
    if (c?.includes('platte city') || c?.includes('parkville') || c?.includes('weston') || c?.includes('riverside') || c?.includes('weatherby lake') || c?.includes('platte woods') || c?.includes('camden point') || c?.includes('edgerton') || c?.includes('tracy')) return { county: 'Platte', state: 'MO' }
  }
  if (s === 'KS') {
    if (c?.includes('overland park') || c?.includes('olathe') || c?.includes('shawnee') || c?.includes('lenexa') || c?.includes('leawood') || c?.includes('prairie village') || c?.includes('merriam') || c?.includes('gardner')) return { county: 'Johnson', state: 'KS' }
    if (c?.includes('kansas city') || c?.includes('bonner springs') || c?.includes('edwardsville')) return { county: 'Wyandotte', state: 'KS' }
  }
  if (zip) {
    const z = parseInt(String(zip).slice(0, 5))
    // Clay County MO (north of the river KC): 64116-64119, 64157-64158, 64024, 64068-64069, 64073, 64081, 64089
    // Check Clay BEFORE Jackson so KC-MO-north (64117, 64118) doesn't fall into Jackson's broad 64101-64199 range.
    const clayZips = new Set([64024, 64068, 64069, 64073, 64089, 64116, 64117, 64118, 64119, 64156, 64157, 64158, 64161, 64165, 64166, 64167])
    if (clayZips.has(z)) return { county: 'Clay', state: 'MO' }
    // Platte County MO: 64150-64154, plus a few outliers
    if ((z >= 64150 && z <= 64154) || z === 64079 || z === 64083 || z === 64098) return { county: 'Platte', state: 'MO' }
    // Jackson County, MO: Kansas City metro + eastern cities (Independence, Blue Springs, Lee's Summit, Raytown, Grandview, Summit)
    if ((z >= 64012 && z <= 64089) || (z >= 64101 && z <= 64199)) return { county: 'Jackson', state: 'MO' }
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
