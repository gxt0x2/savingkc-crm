import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { CountyEnrichmentService, EnrichmentInput } from '@/lib/county-enrichment'
import type { ManifestV2 } from '@/lib/manifest-builder'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/enrich — Enrich property from county assessor
export async function POST(req: NextRequest) {
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
  // Fetch existing manifest
  const { data: existing, error: fetchError } = await supabase
    .from('manifests')
    .select('manifest')
    .eq('id', manifestId)
    .single()

  if (fetchError || !existing) {
    throw new Error('Manifest not found')
  }

  const currentManifest = existing.manifest as ManifestV2

  // Build updated property section
  const updatedProperty = {
    ...currentManifest.property,
  }

  // Update assessment
  if (enrichment.appraisedValue || enrichment.assessedValue || enrichment.landValue || enrichment.improvementValue) {
    updatedProperty.assessment = {
      ...currentManifest.property.assessment,
      totalValue: enrichment.appraisedValue || currentManifest.property.assessment?.totalValue,
      landValue: enrichment.landValue || currentManifest.property.assessment?.landValue,
      improvementValue: enrichment.improvementValue || currentManifest.property.assessment?.improvementValue,
    }
  }

  // Update dwelling
  if (enrichment.sqft || enrichment.bedrooms || enrichment.bathrooms || enrichment.yearBuilt) {
    updatedProperty.dwelling = {
      ...currentManifest.property.dwelling,
      sqft: enrichment.sqft || currentManifest.property.dwelling?.sqft,
      bedrooms: enrichment.bedrooms || currentManifest.property.dwelling?.bedrooms,
      bathrooms: enrichment.bathrooms || currentManifest.property.dwelling?.bathrooms,
      yearBuilt: enrichment.yearBuilt || currentManifest.property.dwelling?.yearBuilt,
      style: enrichment.propertyType || currentManifest.property.dwelling?.style,
    }
  }

  // Update parcel
  if (enrichment.parcelId) {
    updatedProperty.parcel = enrichment.parcelId
  }

  // Update taxCollector (if we have tax data)
  if (enrichment.taxOwed !== undefined) {
    updatedProperty.taxCollector = {
      ...currentManifest.property.taxCollector,
      delinquentAmount: enrichment.taxOwed,
    }
  }

  // Build updated manifest
  const now = new Date().toISOString()
  const updatedManifest: ManifestV2 = {
    ...currentManifest,
    property: updatedProperty,
    lastUpdated: now,
    lastUpdatedBy: 'system:enrichment',
    auditTrail: [
      ...(currentManifest.auditTrail || []),
      {
        timestamp: now,
        agent: 'system:enrichment',
        action: 'county_enrichment_complete',
        details: {
          county: enrichment.county,
          source: enrichment.source,
          result: 'success',
        },
      },
    ],
  }

  // Update in Supabase
  const { error: updateError } = await supabase
    .from('manifests')
    .update({
      manifest: updatedManifest,
      updated_at: now,
    })
    .eq('id', manifestId)

  if (updateError) {
    throw new Error(`Manifest update failed: ${updateError.message}`)
  }
}
