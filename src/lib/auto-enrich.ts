/**
 * Auto-Enrichment — runs fire-and-forget after lead/manifest creation.
 *
 * Two enrichment paths:
 * 1. Prospect lookup (fast, DB query) — matches phone to tax delinquent prospects
 * 2. County enrichment (slow, scraper) — fetches assessor data by address
 *
 * Both can run in parallel. Prospect gives quick data (zestimate, tax owed, deceased flag).
 * County adds fresh assessor data (appraised value, dwelling specs, parcel ID).
 */

import { createClient } from '@supabase/supabase-js'
import { lookupProspectByPhone } from './prospect-lookup'
import { detectCounty, CountyEnrichmentService } from './county-enrichment'
import { enrichManifestProperty, scoreManifest } from './manifest-enrichment'
import { updateManifestAndCascade } from './manifest-sync'
import type { ManifestV2 } from './manifest-builder'
import type { ProspectMatch } from './prospect-lookup'
import { getSupabaseAdminKey, getSupabaseUrl } from './supabase/env'

function getSupabase() {
  return createClient(
    getSupabaseUrl(),
    getSupabaseAdminKey(),
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

/**
 * Auto-enrich a lead after creation. Fire-and-forget — never blocks lead creation.
 * Runs prospect lookup + county enrichment, updates manifest with results.
 */
export async function autoEnrichLead(leadId: string): Promise<void> {
  console.log('[auto-enrich] Starting for lead', leadId)
  try {
    const supabase = getSupabase()

    // Fetch lead data
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone, property_address, city, state, zip, county, source')
      .eq('id', leadId)
      .single()

    if (!lead) {
      console.log('[auto-enrich] Lead not found:', leadId)
      return
    }
    console.log('[auto-enrich] Lead data:', { phone: lead.phone, address: lead.property_address, source: lead.source })

    // Skip if lead came from prospect path (already enriched)
    if (lead.source?.startsWith('tax_delinquent_')) {
      console.log('[auto-enrich] Skipping - lead from prospect path (already enriched)')
      return
    }

    console.log('[auto-enrich] Checking manifest for existing enrichment...')
    // Check if already enriched by looking at manifest audit trail
    try {
      const { data: manifest, error: manifestError } = await supabase
        .from('manifests')
        .select('manifest')
        .eq('lead_id', leadId)
        .single()

      if (manifestError) {
        console.log('[auto-enrich] Manifest query error (will continue anyway):', manifestError.message)
      }

      if (manifest?.manifest?.auditTrail) {
        const hasProspectEnrichment = manifest.manifest.auditTrail.some((e: any) =>
          e.action === 'prospect_enrichment_complete' || e.agent === 'system:auto_enrich_prospect'
        )
        const hasCountyEnrichment = manifest.manifest.auditTrail.some((e: any) =>
          e.action === 'county_enrichment_complete' || e.agent === 'system:auto_enrich_county'
        )

        if (hasProspectEnrichment && hasCountyEnrichment) {
          console.log('[auto-enrich] Skipping - already enriched (found both prospect and county in audit trail)')
          return
        }
        if (hasProspectEnrichment || hasCountyEnrichment) {
          console.log('[auto-enrich] Partial enrichment detected, will run missing enrichments')
        }
      }
    } catch (err) {
      console.error('[auto-enrich] Error checking manifest enrichment status:', err)
      // Continue anyway - better to try enriching than skip
    }
    console.log('[auto-enrich] Dedup check complete, proceeding with enrichment...')

    // Run enrichments in parallel
    const promises: Promise<void>[] = []

    // 1. Prospect lookup by phone
    if (lead.phone) {
      console.log('[auto-enrich] Queuing prospect enrichment for phone:', lead.phone)
      promises.push(enrichFromProspect(leadId, lead.phone))
    } else {
      console.log('[auto-enrich] Skipping prospect enrichment - no phone')
    }

    // 2. County enrichment by address
    if (lead.property_address) {
      console.log('[auto-enrich] Queuing county enrichment for address:', lead.property_address)
      let city = lead.city
      let state = lead.state
      let zip = lead.zip
      let county = lead.county

      // Parse address for missing fields
      if (!county || !state) {
        const { parseAddressForCounty } = await import('./county-enrichment')
        const parsed = parseAddressForCounty(lead.property_address)
        if (parsed) {
          city = city || parsed.city
          state = state || parsed.state
          zip = zip || parsed.zip
          county = county || parsed.county
        }
      }

      // Determine correct state. County-specific state wins over stale lead
      // state, e.g. Johnson County must route to KS even if the lead row says MO.
      const expectedState = expectedStateForCounty(county)
      const inferredState = expectedState || state || 'MO'

      const countyObj = county
        ? { county, state: inferredState }
        : detectCounty(city, state, zip)

      if (countyObj) {
        promises.push(enrichFromCounty(leadId, {
          address: lead.property_address,
          city: city || undefined,
          state: countyObj.state,
          zip: zip || undefined,
          county: countyObj.county,
        }))
      }
    }

    console.log('[auto-enrich] Queued', promises.length, 'enrichment(s), awaiting completion...')
    if (promises.length > 0) {
      const results = await Promise.allSettled(promises)
      console.log('[auto-enrich] Enrichments completed. Results:', results.map(r => r.status))

      // Log any rejections
      results.forEach((result, idx) => {
        if (result.status === 'rejected') {
          console.error(`[auto-enrich] Enrichment ${idx} rejected:`, result.reason)
        }
      })
    } else {
      console.log('[auto-enrich] No enrichments queued - nothing to do')
    }
    console.log('[auto-enrich] Finished for lead', leadId)
  } catch (err) {
    console.error('[auto-enrich] Failed for lead', leadId, err)
  }
}

function expectedStateForCounty(county?: string | null): 'KS' | 'MO' | null {
  const normalized = county?.toLowerCase().trim()
  if (!normalized) return null
  if (['johnson', 'wyandotte', 'leavenworth', 'miami', 'douglas'].includes(normalized)) return 'KS'
  if (['jackson', 'clay', 'platte'].includes(normalized)) return 'MO'
  return null
}

/**
 * Enrich from prospect match — fast DB lookup.
 * Adds zestimate (as ARV), tax data, deceased flag, opportunity flags.
 */
async function enrichFromProspect(leadId: string, phone: string): Promise<void> {
  console.log('[auto-enrich] enrichFromProspect starting for lead', leadId, 'phone', phone)
  const matches = await lookupProspectByPhone(phone)
  console.log('[auto-enrich] Prospect lookup returned', matches.length, 'matches')
  if (matches.length === 0) {
    console.log('[auto-enrich] No prospect matches found')
    return
  }

  const match = matches[0] // Best match (sorted: owner first, 3yr+, highest debt)

  await updateManifestAndCascade(leadId, (manifest) => {
    // Only fill in what's missing — don't overwrite existing data
    if (!manifest.financials) manifest.financials = {} as any

    if (!manifest.financials!.arv && match.zestimate) {
      manifest.financials!.arv = match.zestimate
      manifest.financials!.arv_source = 'zestimate' as any
    }

    if (!manifest.financials!.back_taxes && match.cumulative_due) {
      manifest.financials!.back_taxes = match.cumulative_due
    }

    // Tax data
    if (match.cumulative_due && !manifest.property.taxCollector?.delinquentAmount) {
      manifest.property.taxCollector = {
        ...manifest.property.taxCollector,
        totalOwed: match.cumulative_due,
        delinquentAmount: match.cumulative_due,
        yearsDelinquent: match.earliest_delinquent_year
          ? new Date().getFullYear() - match.earliest_delinquent_year
          : undefined,
      }
    }

    // Market value as assessment
    if (match.total_market_value && !manifest.property.assessment?.totalValue) {
      manifest.property.assessment = {
        ...manifest.property.assessment,
        totalValue: match.total_market_value,
      }
    }

    // Parcel ID
    if (match.parcel_id && !manifest.property.parcel) {
      manifest.property.parcel = match.parcel_id
    }

    // Deceased flag
    if (match.is_deceased && !manifest.owner.deceased) {
      manifest.owner.deceased = true
      if (!manifest.situation.type.includes('inherited')) {
        manifest.situation.type.push('inherited')
      }
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('deceased_owner')) {
        manifest.flags.opportunityFlags.push('deceased_owner')
      }
    }

    // Out-of-state owner
    if (match.mailing_state && match.situs_state &&
        match.mailing_state.toUpperCase() !== match.situs_state.toUpperCase()) {
      manifest.owner.outOfState = true
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('out_of_state_owner')) {
        manifest.flags.opportunityFlags.push('out_of_state_owner')
      }
    }

    // Tax delinquent flags
    if (match.cumulative_due && match.cumulative_due > 0) {
      if (!manifest.situation.type.includes('tax_delinquent')) {
        manifest.situation.type.push('tax_delinquent')
      }
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (match.delinquent_years_category === '3yr_plus' &&
          !manifest.flags.opportunityFlags.includes('3yr_tax_delinquent')) {
        manifest.flags.opportunityFlags.push('3yr_tax_delinquent')
      }
    }

    // Audit trail
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:auto_enrich_prospect',
      action: 'prospect_enrichment_complete',
      details: {
        parcel_id: match.parcel_id,
        county: match.county,
        cumulative_due: match.cumulative_due,
        zestimate: match.zestimate,
        is_deceased: match.is_deceased,
        matched: true,
      },
    })
  }, 'system:auto_enrich')

  // Link prospect to lead if not already linked
  if (!match.lead_id) {
    const supabase = getSupabase()
    await supabase.from('prospects')
      .update({ lead_id: leadId })
      .eq('id', match.prospect_id)
  }
  console.log('[auto-enrich] enrichFromProspect COMPLETED for lead', leadId)
}

/**
 * Enrich from county assessor — supplements prospect data with dwelling + assessment details.
 */
async function enrichFromCounty(
  leadId: string,
  input: { address: string; city?: string; state: string; zip?: string; county: string },
): Promise<void> {
  console.log('[auto-enrich] enrichFromCounty starting for lead', leadId, 'county', input.county, 'address', input.address)
  const service = new CountyEnrichmentService()
  const result = await service.enrich(input)
  console.log('[auto-enrich] County enrichment result:', result.success ? 'SUCCESS' : 'FAILED', result.error || '')

  if (!result.success) {
    console.warn('[auto-enrich] County enrichment failed for lead', leadId, result.error)
    return
  }

  // Apply county data to manifest
  await applyCountyData(leadId, result)
}

/**
 * Apply county enrichment data to manifest.
 * Extracted from enrichFromCounty to allow composition with Zillow.
 */
async function applyCountyData(leadId: string, result: any): Promise<void> {

  await updateManifestAndCascade(leadId, (manifest) => {
    // Assessment data (prefer county assessor over existing)
    if (result.appraisedValue || result.assessedValue || result.landValue || result.improvementValue) {
      manifest.property.assessment = {
        ...manifest.property.assessment,
        totalValue: result.appraisedValue || manifest.property.assessment?.totalValue,
        landValue: result.landValue || manifest.property.assessment?.landValue,
        improvementValue: result.improvementValue || manifest.property.assessment?.improvementValue,
      }
    }

    // Dwelling data
    if (result.sqft || result.bedrooms || result.bathrooms || result.yearBuilt) {
      manifest.property.dwelling = {
        ...manifest.property.dwelling,
        sqft: result.sqft || manifest.property.dwelling?.sqft,
        bedrooms: result.bedrooms || manifest.property.dwelling?.bedrooms,
        bathrooms: result.bathrooms || manifest.property.dwelling?.bathrooms,
        yearBuilt: result.yearBuilt || manifest.property.dwelling?.yearBuilt,
        style: result.propertyType || manifest.property.dwelling?.style,
      }
    }

    // Parcel ID
    if (result.parcelId && !manifest.property.parcel) {
      manifest.property.parcel = result.parcelId
    }

    // Tax data
    if (result.taxOwed !== undefined) {
      manifest.property.taxCollector = {
        ...manifest.property.taxCollector,
        delinquentAmount: result.taxOwed || manifest.property.taxCollector?.delinquentAmount,
      }
      if (result.taxStatus) {
        (manifest.property.taxCollector as any).status = result.taxStatus
      }
    }

    // Owner name (only if manifest has no owner name)
    if (result.ownerName && (!manifest.owner.firstName || manifest.owner.firstName === 'Unknown')) {
      const parts = result.ownerName.split(/\s+/)
      manifest.owner.firstName = parts[0]
      manifest.owner.lastName = parts.slice(1).join(' ') || manifest.owner.lastName
    }

    // Audit trail
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:auto_enrich_county',
      action: 'county_enrichment_complete',
      details: {
        county: result.county,
        source: result.source,
        appraisedValue: result.appraisedValue,
        sqft: result.sqft,
        yearBuilt: result.yearBuilt,
        taxStatus: result.taxStatus,
      },
    })
  }, 'system:auto_enrich')
}

/**
 * Force re-enrich a lead — OVERWRITES existing data with fresh enrichment.
 * Unlike autoEnrichLead, this does NOT skip any sources and always overwrites.
 * Used for batch re-enrichment when leads now have addresses/phones.
 *
 * Updates: manifest property (assessment, dwelling, taxCollector), financials,
 * owner flags, opportunity/red flags, qualification score, tier, ARI briefing stale.
 * Also cascades housing details back to leads table.
 */
export async function forceReenrichLead(leadId: string): Promise<{
  success: boolean
  prospectMatch: boolean
  countyEnriched: boolean
  error?: string
}> {
  const result = { success: false, prospectMatch: false, countyEnriched: false, error: undefined as string | undefined }

  try {
    const supabase = getSupabase()

    // Fetch lead data
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone, property_address, city, state, zip, county, source')
      .eq('id', leadId)
      .single()

    if (!lead) {
      result.error = 'Lead not found'
      return result
    }

    // 1. Force prospect enrichment (overwrites existing)
    if (lead.phone) {
      const prospectDone = await forceEnrichFromProspect(leadId, lead.phone)
      result.prospectMatch = prospectDone
    }

    // 2. Force county enrichment (overwrites existing)
    if (lead.property_address) {
      const county = lead.county
        ? { county: lead.county, state: lead.state || 'MO' }
        : detectCounty(lead.city, lead.state, lead.zip)

      if (county) {
        const countyDone = await forceEnrichFromCounty(leadId, {
          address: lead.property_address,
          city: lead.city || undefined,
          state: county.state,
          zip: lead.zip || undefined,
          county: county.county,
        })
        result.countyEnriched = countyDone
      }
    }

    // 3. Re-score manifest + mark ARI stale + cascade housing to leads table
    await updateManifestAndCascade(leadId, (manifest) => {
      // Re-score
      const { score, tier } = scoreManifest(manifest)
      manifest.qualificationScore = score
      manifest.tier = tier as ManifestV2['tier']

      // Mark ARI briefing stale so it regenerates
      if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
      manifest.ariIntelligence.briefingStale = true

      manifest.auditTrail.push({
        timestamp: new Date().toISOString(),
        agent: 'system:batch_reenrich',
        action: 'rescored_after_reenrich',
        details: { score, tier },
      })
    }, 'system:batch_reenrich')

    // 4. Cascade housing details from manifest to leads table
    await cascadeHousingToLead(leadId)

    result.success = true
  } catch (err: any) {
    console.error('[force-reenrich] Failed for lead', leadId, err)
    result.error = err.message || 'Unknown error'
  }

  return result
}

/**
 * Force prospect enrichment — ALWAYS overwrites existing manifest data.
 */
async function forceEnrichFromProspect(leadId: string, phone: string): Promise<boolean> {
  const matches = await lookupProspectByPhone(phone)
  if (matches.length === 0) return false

  const match = matches[0]

  await updateManifestAndCascade(leadId, (manifest) => {
    if (!manifest.financials) manifest.financials = {} as any

    // Always overwrite ARV from prospect
    if (match.zestimate) {
      manifest.financials!.arv = match.zestimate
      manifest.financials!.arv_source = 'zestimate' as any
    }

    if (match.cumulative_due) {
      manifest.financials!.back_taxes = match.cumulative_due
    }

    // Always overwrite tax data from prospect
    if (match.cumulative_due) {
      manifest.property.taxCollector = {
        ...manifest.property.taxCollector,
        totalOwed: match.cumulative_due,
        delinquentAmount: match.cumulative_due,
        yearsDelinquent: match.earliest_delinquent_year
          ? new Date().getFullYear() - match.earliest_delinquent_year
          : manifest.property.taxCollector?.yearsDelinquent,
      }
    }

    // Always overwrite market value
    if (match.total_market_value) {
      manifest.property.assessment = {
        ...manifest.property.assessment,
        totalValue: match.total_market_value,
      }
    }

    // Always set parcel
    if (match.parcel_id) {
      manifest.property.parcel = match.parcel_id
    }

    // Deceased flag
    if (match.is_deceased) {
      manifest.owner.deceased = true
      if (!manifest.situation.type.includes('inherited')) {
        manifest.situation.type.push('inherited')
      }
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('deceased_owner')) {
        manifest.flags.opportunityFlags.push('deceased_owner')
      }
    }

    // Out-of-state owner
    if (match.mailing_state && match.situs_state &&
        match.mailing_state.toUpperCase() !== match.situs_state.toUpperCase()) {
      manifest.owner.outOfState = true
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('out_of_state_owner')) {
        manifest.flags.opportunityFlags.push('out_of_state_owner')
      }
    }

    // Tax delinquent flags
    if (match.cumulative_due && match.cumulative_due > 0) {
      if (!manifest.situation.type.includes('tax_delinquent')) {
        manifest.situation.type.push('tax_delinquent')
      }
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (match.delinquent_years_category === '3yr_plus' &&
          !manifest.flags.opportunityFlags.includes('3yr_tax_delinquent')) {
        manifest.flags.opportunityFlags.push('3yr_tax_delinquent')
      }
    }

    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:batch_reenrich_prospect',
      action: 'force_enriched_from_prospect',
      details: {
        parcel_id: match.parcel_id,
        county: match.county,
        cumulative_due: match.cumulative_due,
        zestimate: match.zestimate,
        is_deceased: match.is_deceased,
      },
    })
  }, 'system:batch_reenrich')

  // Link prospect to lead
  if (!match.lead_id) {
    const supabase = getSupabase()
    await supabase.from('prospects')
      .update({ lead_id: leadId })
      .eq('id', match.prospect_id)
  }

  return true
}

/**
 * Force county enrichment — ALWAYS overwrites existing manifest data.
 */
async function forceEnrichFromCounty(
  leadId: string,
  input: { address: string; city?: string; state: string; zip?: string; county: string },
): Promise<boolean> {
  const service = new CountyEnrichmentService()
  const result = await service.enrich(input)

  if (!result.success) {
    console.warn('[force-reenrich] County enrichment failed for lead', leadId, result.error)
    return false
  }

  await updateManifestAndCascade(leadId, (manifest) => {
    // Always overwrite assessment
    if (result.appraisedValue || result.assessedValue || result.landValue || result.improvementValue) {
      manifest.property.assessment = {
        ...manifest.property.assessment,
        totalValue: result.appraisedValue || manifest.property.assessment?.totalValue,
        landValue: result.landValue || manifest.property.assessment?.landValue,
        improvementValue: result.improvementValue || manifest.property.assessment?.improvementValue,
        appraisedTotal: result.appraisedValue || manifest.property.assessment?.appraisedTotal,
        assessedTotal: result.assessedValue || manifest.property.assessment?.assessedTotal,
        assessmentYear: new Date().getFullYear(),
        source: result.source,
        fetchedAt: result.fetchedAt,
      }
    }

    // Always overwrite dwelling
    if (result.sqft || result.bedrooms || result.bathrooms || result.yearBuilt) {
      manifest.property.dwelling = {
        ...manifest.property.dwelling,
        sqft: result.sqft || manifest.property.dwelling?.sqft,
        bedrooms: result.bedrooms || manifest.property.dwelling?.bedrooms,
        bathrooms: result.bathrooms || manifest.property.dwelling?.bathrooms,
        yearBuilt: result.yearBuilt || manifest.property.dwelling?.yearBuilt,
        propertyType: result.propertyType || manifest.property.dwelling?.propertyType,
        style: result.rawData?.propertyStyle || manifest.property.dwelling?.style,
        basement: result.rawData?.basementDesc || manifest.property.dwelling?.basement,
        finishedBasementSqft: result.rawData?.finishedBasementSqft || manifest.property.dwelling?.finishedBasementSqft,
        totalBasementSqft: result.rawData?.totalBasementSqft || manifest.property.dwelling?.totalBasementSqft,
        garageSize: result.rawData?.garageSize || manifest.property.dwelling?.garageSize,
        exterior: result.rawData?.exterior || manifest.property.dwelling?.exterior,
        roofType: result.rawData?.roofType || manifest.property.dwelling?.roofType,
        hvac: result.rawData?.hvac || manifest.property.dwelling?.hvac,
        hasFireplace: result.rawData?.hasFireplace ?? manifest.property.dwelling?.hasFireplace,
        totalRooms: result.rawData?.totalRooms || manifest.property.dwelling?.totalRooms,
        source: result.source,
        fetchedAt: result.fetchedAt,
      }
    }

    // Always overwrite tax collector
    if (result.taxOwed !== undefined) {
      manifest.property.taxCollector = {
        ...manifest.property.taxCollector,
        totalOwed: result.taxOwed || manifest.property.taxCollector?.totalOwed,
        delinquentAmount: result.taxOwed || manifest.property.taxCollector?.delinquentAmount,
        taxStatus: result.taxStatus || manifest.property.taxCollector?.taxStatus,
        delinquentYears: result.rawData?.taxYearsPastDue || manifest.property.taxCollector?.delinquentYears,
        yearsDelinquent: result.rawData?.numYearsPastDue || manifest.property.taxCollector?.yearsDelinquent,
        currentAmountDue: result.rawData?.currentAmountDue || manifest.property.taxCollector?.currentAmountDue,
        pastYearsDue: result.rawData?.pastYearsDue || manifest.property.taxCollector?.pastYearsDue,
        source: result.source,
        fetchedAt: result.fetchedAt,
      }
    }

    // Always set parcel
    if (result.parcelId) {
      manifest.property.parcel = result.parcelId
    }

    // Owner name (only if Unknown)
    if (result.ownerName && (!manifest.owner.firstName || manifest.owner.firstName === 'Unknown')) {
      const parts = result.ownerName.split(/\s+/)
      manifest.owner.firstName = parts[0]
      manifest.owner.lastName = parts.slice(1).join(' ') || manifest.owner.lastName
    }

    // Opportunity flags
    const appraisedValue = result.appraisedValue || 0
    const taxOwed = result.taxOwed || 0
    const equity = appraisedValue - taxOwed
    if (appraisedValue > 0 && equity > 100000) {
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('high_equity')) {
        manifest.flags.opportunityFlags.push('high_equity')
      }
    }

    // Out-of-state from county enrichment
    if (result.mailingAddress) {
      const mailingStateMatch = result.mailingAddress.match(/\b([A-Z]{2})\s+\d{5}/i)
      const mailingState = mailingStateMatch?.[1]?.toUpperCase()
      const propertyState = input.state?.toUpperCase()
      if (mailingState && mailingState !== propertyState && mailingState !== 'MO' && mailingState !== 'KS') {
        manifest.owner.outOfState = true
        if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
        if (!manifest.flags.opportunityFlags.includes('out_of_state_owner')) {
          manifest.flags.opportunityFlags.push('out_of_state_owner')
        }
      }
    } else if (result.rawData?.outOfState === true) {
      manifest.owner.outOfState = true
      if (!manifest.flags.opportunityFlags) manifest.flags.opportunityFlags = []
      if (!manifest.flags.opportunityFlags.includes('out_of_state_owner')) {
        manifest.flags.opportunityFlags.push('out_of_state_owner')
      }
    }

    // Red flag for delinquent tax
    if (result.taxStatus?.toLowerCase().includes('delinquent')) {
      if (!manifest.flags.redFlags) manifest.flags.redFlags = []
      if (!manifest.flags.redFlags.includes('tax_delinquent')) {
        manifest.flags.redFlags.push('tax_delinquent')
      }
      if (!manifest.situation.type.includes('tax_delinquent')) {
        manifest.situation.type.push('tax_delinquent')
      }
    }

    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:batch_reenrich_county',
      action: 'force_county_enrichment_complete',
      details: {
        county: result.county,
        source: result.source,
        appraisedValue: result.appraisedValue,
        sqft: result.sqft,
        yearBuilt: result.yearBuilt,
        taxStatus: result.taxStatus,
        taxOwed: result.taxOwed,
      },
    })
  }, 'system:batch_reenrich')

  return true
}

/**
 * Cascade housing details from manifest to leads table.
 * The manifest is source of truth — leads table is a display cache.
 */
async function cascadeHousingToLead(leadId: string): Promise<void> {
  const supabase = getSupabase()

  // Fetch manifest
  const { data: row } = await supabase
    .from('manifests')
    .select('manifest')
    .eq('lead_id', leadId)
    .limit(1)
    .single()

  if (!row?.manifest) return
  const m = row.manifest as ManifestV2
  const prop = m.property as any
  const d = prop.dwelling
  const a = prop.assessment
  const t = prop.taxCollector
  const now = new Date().toISOString()

  const leadUpdate: Record<string, any> = {}

  // Dwelling fields
  if (d?.bedrooms) leadUpdate.beds = d.bedrooms
  if (d?.bathrooms) leadUpdate.baths_full = d.bathrooms
  if (d?.sqft) leadUpdate.sqft = d.sqft
  if (d?.yearBuilt) leadUpdate.year_built = d.yearBuilt
  if (d?.propertyType || d?.style) leadUpdate.property_type = d.propertyType || d.style
  if (d?.basement) leadUpdate.basement_type = d.basement
  if (d?.garageSize) leadUpdate.garage_spaces = typeof d.garageSize === 'string' ? parseInt(d.garageSize) || null : d.garageSize
  if (d?.roofType) leadUpdate.roof_type = d.roofType
  if (d?.hvac) leadUpdate.heating = d.hvac

  // Lot size (from Zillow or county)
  if (prop.lot?.sizeSqft) leadUpdate.lot_size = prop.lot.sizeSqft

  // Assessment
  if (a?.totalValue) leadUpdate.tax_assessment = a.totalValue

  // ARV from financials (could be from Zestimate via Zillow)
  if (m.financials?.arv) leadUpdate.arv = m.financials.arv

  // Last sale data (from Zillow)
  if (prop.sales?.lastSaleDate) leadUpdate.last_sale_date = prop.sales.lastSaleDate
  if (prop.sales?.lastSalePrice) leadUpdate.last_sale_price = prop.sales.lastSalePrice

  // County from property
  if (a?.source) leadUpdate.data_source = a.source
  leadUpdate.data_enriched_at = now

  if (Object.keys(leadUpdate).length > 0) {
    await supabase
      .from('leads')
      .update(leadUpdate)
      .eq('id', leadId)
  }
}
