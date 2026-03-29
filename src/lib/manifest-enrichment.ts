// Manifest Enrichment & Scoring
// Enriches manifest with county property data and calculates qualification score

import { CountyEnrichmentService, type EnrichmentInput } from './county-enrichment'
import type { ManifestV2 } from './manifest-builder'

/**
 * Enrich manifest with county property data
 */
export async function enrichManifestProperty(
  manifest: ManifestV2,
  address: string,
  city: string | undefined,
  state: string,
  zip: string | undefined,
  county: string
): Promise<ManifestV2> {
  const service = new CountyEnrichmentService()

  const enrichmentInput: EnrichmentInput = {
    address,
    city,
    state,
    zip,
    county,
  }

  const result = await service.enrich(enrichmentInput)

  if (!result.success) {
    // Enrichment failed — append error to audit trail but don't throw
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:enrichment',
      action: 'enrichment_failed',
      details: {
        county,
        error: result.error,
      },
    })
    return manifest
  }

  // Update manifest.property with enriched data
  manifest.property.parcel = result.parcelId || manifest.property.parcel

  manifest.property.assessment = {
    landValue: result.landValue || manifest.property.assessment?.landValue,
    improvementValue: result.improvementValue || manifest.property.assessment?.improvementValue,
    totalValue: result.appraisedValue || manifest.property.assessment?.totalValue,
    appraisedTotal: result.appraisedValue || manifest.property.assessment?.appraisedTotal,
    assessedTotal: result.assessedValue || manifest.property.assessment?.assessedTotal,
    assessmentYear: new Date().getFullYear(),
    source: result.source,
    fetchedAt: result.fetchedAt,
  }

  manifest.property.taxCollector = {
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

  manifest.property.dwelling = {
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

  // Add enrichment success to audit trail
  manifest.auditTrail.push({
    timestamp: new Date().toISOString(),
    agent: 'system:enrichment',
    action: 'property_enriched',
    details: {
      county,
      source: result.source,
      parcelId: result.parcelId,
      appraisedValue: result.appraisedValue,
      taxStatus: result.taxStatus,
      taxOwed: result.taxOwed,
    },
  })

  // Add opportunity flag if property has equity
  const appraisedValue = result.appraisedValue || 0
  const taxOwed = result.taxOwed || 0
  const equity = appraisedValue - taxOwed

  if (appraisedValue > 0 && equity > 100000) {
    manifest.flags.opportunityFlags = manifest.flags.opportunityFlags || []
    if (!manifest.flags.opportunityFlags.includes('high_equity')) {
      manifest.flags.opportunityFlags.push('high_equity')
    }
  }

  // Add red flag if tax delinquent
  if (result.taxStatus?.toLowerCase().includes('delinquent')) {
    manifest.flags.redFlags = manifest.flags.redFlags || []
    if (!manifest.flags.redFlags.includes('tax_delinquent')) {
      manifest.flags.redFlags.push('tax_delinquent')
      manifest.situation.type.push('tax_delinquent')
    }
  }

  manifest.lastUpdated = new Date().toISOString()
  manifest.lastUpdatedBy = 'system:enrichment'

  return manifest
}

/**
 * Score manifest based on property data and situation
 */
export function scoreManifest(manifest: ManifestV2): { score: number; tier: string } {
  let score = 0

  const appraisedValue = manifest.property.assessment?.totalValue || 0
  const taxOwed = manifest.property.taxCollector?.delinquentAmount || 0
  const equity = appraisedValue - taxOwed
  const yearBuilt = manifest.property.dwelling?.yearBuilt || 0
  const sqft = manifest.property.dwelling?.sqft || 0

  // Scoring logic
  // 1. High equity (25 points)
  if (appraisedValue > 0 && equity > 100000) {
    score += 25
  }

  // 2. High tax delinquency (25 points)
  if (taxOwed > 5000) {
    score += 25
  }

  // 3. Tax delinquent status (15 points)
  const hasDelinquentFlag = manifest.flags.redFlags?.includes('tax_delinquent') || false
  if (hasDelinquentFlag) {
    score += 15
  }

  // 4. Older property (10 points)
  if (yearBuilt > 0 && yearBuilt < 1990) {
    score += 10
  }

  // 5. Data completeness (5 points)
  if (sqft > 0) {
    score += 5
  }

  // Cap at 100
  score = Math.min(score, 100)

  // Tier assignment
  let tier = 'dead'
  if (score >= 80) {
    tier = 'cream'
  } else if (score >= 60) {
    tier = 'hot'
  } else if (score >= 40) {
    tier = 'warm'
  } else if (score >= 20) {
    tier = 'cool'
  }

  return { score, tier }
}
