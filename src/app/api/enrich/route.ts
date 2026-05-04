import { NextRequest, NextResponse } from 'next/server'
import { CountyEnrichmentService, EnrichmentInput } from '@/lib/county-enrichment'
import type { ManifestV2 } from '@/lib/manifest-builder'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

// POST /api/enrich — Enrich property from county assessor
export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body: EnrichmentInput = await req.json()

    // Validate required fields
    if (!body.address || !body.state || !body.county) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: address, state, county' },
        { status: 400 }
      )
    }

    // Run enrichment
    const service = new CountyEnrichmentService()
    const result = await service.enrich(body)

    // If successful and manifest_id provided, update the manifest
    if (result.success && body.manifest_id) {
      try {
        await updateManifest(body.manifest_id, result)
      } catch (manifestErr: any) {
        console.error('Manifest update failed:', manifestErr)
        // Don't fail the whole request if manifest update fails
        return NextResponse.json({
          ...result,
          manifestUpdateError: manifestErr.message,
        })
      }
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('Enrichment API error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err.message || 'Internal server error',
      },
      { status: 500 }
    )
  }
}

/**
 * Update manifest with enrichment data
 */
async function updateManifest(manifestId: string, enrichment: any) {
  const { data: row } = await supabase
    .from('manifests').select('lead_id').eq('id', manifestId).single()
  if (!row?.lead_id) throw new Error('Manifest not found or has no lead_id')

  const { updateManifestAndCascade } = await import('@/lib/manifest-sync')
  const cascaded = await updateManifestAndCascade(row.lead_id, (manifest: any) => {
    if (enrichment.appraisedValue || enrichment.assessedValue || enrichment.landValue || enrichment.improvementValue) {
      manifest.property.assessment = {
        ...manifest.property.assessment,
        totalValue: enrichment.appraisedValue || manifest.property.assessment?.totalValue,
        landValue: enrichment.landValue || manifest.property.assessment?.landValue,
        improvementValue: enrichment.improvementValue || manifest.property.assessment?.improvementValue,
      }
    }
    if (enrichment.sqft || enrichment.bedrooms || enrichment.bathrooms || enrichment.yearBuilt) {
      manifest.property.dwelling = {
        ...manifest.property.dwelling,
        sqft: enrichment.sqft || manifest.property.dwelling?.sqft,
        bedrooms: enrichment.bedrooms || manifest.property.dwelling?.bedrooms,
        bathrooms: enrichment.bathrooms || manifest.property.dwelling?.bathrooms,
        yearBuilt: enrichment.yearBuilt || manifest.property.dwelling?.yearBuilt,
        style: enrichment.propertyType || manifest.property.dwelling?.style,
      }
    }
    if (enrichment.parcelId) manifest.property.parcel = enrichment.parcelId
    if (enrichment.taxOwed !== undefined) {
      manifest.property.taxCollector = {
        ...manifest.property.taxCollector, delinquentAmount: enrichment.taxOwed,
      }
    }
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(), agent: 'system:enrichment',
      action: 'county_enrichment_complete',
      details: { county: enrichment.county, source: enrichment.source, result: 'success' },
    })
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true
  }, 'api:enrich')

  if (!cascaded) throw new Error('Manifest cascade failed')
}
