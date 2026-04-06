/**
 * Auto-Enrichment — runs fire-and-forget after lead/manifest creation.
 *
 * Two enrichment paths:
 * 1. Prospect lookup (fast, DB query) — matches phone to tax delinquent prospects
 * 2. County enrichment (slow, scraper) — fetches assessor data by address
 *
 * Both can run. Prospect gives quick data (zestimate, tax owed, deceased flag).
 * County adds fresh assessor data (appraised value, dwelling specs, parcel ID).
 */

import { createClient } from '@supabase/supabase-js'
import { lookupProspectByPhone } from './prospect-lookup'
import { detectCounty, CountyEnrichmentService } from './county-enrichment'
import { updateManifestAndCascade } from './manifest-sync'
import type { ManifestV2 } from './manifest-builder'
import type { ProspectMatch } from './prospect-lookup'

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

/**
 * Auto-enrich a lead after creation. Fire-and-forget — never blocks lead creation.
 * Runs prospect lookup + county enrichment, updates manifest with results.
 */
export async function autoEnrichLead(leadId: string): Promise<void> {
  try {
    const supabase = getSupabase()

    // Fetch lead data
    const { data: lead } = await supabase
      .from('leads')
      .select('id, phone, property_address, city, state, zip, county, source')
      .eq('id', leadId)
      .single()

    if (!lead) return

    // Skip if lead came from prospect path (already enriched)
    if (lead.source?.startsWith('tax_delinquent_')) return

    // Run enrichments in parallel
    const promises: Promise<void>[] = []

    // 1. Prospect lookup by phone
    if (lead.phone) {
      promises.push(enrichFromProspect(leadId, lead.phone))
    }

    // 2. County enrichment by address
    if (lead.property_address) {
      const county = lead.county
        ? { county: lead.county, state: lead.state || 'MO' }
        : detectCounty(lead.city, lead.state, lead.zip)

      if (county) {
        promises.push(enrichFromCounty(leadId, {
          address: lead.property_address,
          city: lead.city || undefined,
          state: county.state,
          zip: lead.zip || undefined,
          county: county.county,
        }))
      }
    }

    if (promises.length > 0) {
      await Promise.allSettled(promises)
    }
  } catch (err) {
    console.error('[auto-enrich] Failed for lead', leadId, err)
  }
}

/**
 * Enrich from prospect match — fast DB lookup.
 * Adds zestimate (as ARV), tax data, deceased flag, opportunity flags.
 */
async function enrichFromProspect(leadId: string, phone: string): Promise<void> {
  const matches = await lookupProspectByPhone(phone)
  if (matches.length === 0) return

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
      action: 'enriched_from_prospect',
      details: {
        parcel_id: match.parcel_id,
        county: match.county,
        cumulative_due: match.cumulative_due,
        zestimate: match.zestimate,
        is_deceased: match.is_deceased,
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
}

/**
 * Enrich from county assessor — slow (scraper/API).
 * Adds appraised value, dwelling specs, parcel ID, tax status.
 */
async function enrichFromCounty(
  leadId: string,
  input: { address: string; city?: string; state: string; zip?: string; county: string },
): Promise<void> {
  const service = new CountyEnrichmentService()
  const result = await service.enrich(input)

  if (!result.success) {
    console.warn('[auto-enrich] County enrichment failed for lead', leadId, result.error)
    return
  }

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
