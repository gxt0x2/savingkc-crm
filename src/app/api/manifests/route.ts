import { NextRequest } from 'next/server'
import { buildManifest, type BuildManifestInput, type ManifestV2 } from '@/lib/manifest-builder'
import { detectCounty } from '@/lib/county-enrichment'
import { enrichManifestProperty, scoreManifest } from '@/lib/manifest-enrichment'
import { supabase } from '@/lib/supabase-lazy'
import { legacyManifestJson, recordLegacyManifestApiUse } from '@/lib/server/legacy-manifest-api'

type LegacyManifestCreateInput = BuildManifestInput & {
  propertyCity?: string
  propertyState?: string
  propertyZip?: string
  propertyCounty?: string
}

// GET /api/manifests?lead_id=xxx or ?booking_id=xxx
export async function GET(req: NextRequest) {
  recordLegacyManifestApiUse('GET', '/api/manifests')
  try {
    const { searchParams } = new URL(req.url)
    const leadId = searchParams.get('lead_id')
    const bookingId = searchParams.get('booking_id')

    if (!leadId && !bookingId) {
      return legacyManifestJson(
        { error: 'lead_id or booking_id required' },
        { status: 400 }
      )
    }

    let query = supabase.from('manifests').select('*')

    if (leadId) {
      query = query.eq('lead_id', leadId)
    } else if (bookingId) {
      query = query.eq('booking_id', bookingId)
    }

    const { data, error } = await query.order('created_at', { ascending: false })

    if (error) {
      console.error('Manifest query error:', error)
      return legacyManifestJson(
        { error: 'Failed to fetch manifest' },
        { status: 500 }
      )
    }

    // Return first manifest if found, or null
    return legacyManifestJson({
      manifest: data && data.length > 0 ? data[0] : null,
    })
  } catch (err) {
    console.error('Manifests GET error:', err)
    return legacyManifestJson(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}

// POST /api/manifests - Create new manifest
export async function POST(req: NextRequest) {
  recordLegacyManifestApiUse('POST', '/api/manifests')
  try {
    const input = await req.json() as LegacyManifestCreateInput

    // Validate required fields
    if (!input.firstName || (!input.phone && !input.email)) {
      return legacyManifestJson(
        { error: 'firstName and (phone or email) are required' },
        { status: 400 }
      )
    }

    // Build manifest object
    let manifest = buildManifest(input)

    // Insert into Supabase
    const { data, error } = await supabase
      .from('manifests')
      .insert({
        lead_id: input.leadId || null,
        booking_id: input.bookingId || null,
        version: manifest.version,
        manifest: manifest,
        current_station: manifest.currentStation,
        priority: manifest.priority,
        tier: manifest.tier,
        qualification_score: manifest.qualificationScore,
      })
      .select('id, manifest')
      .single()

    if (error) {
      console.error('Manifest insert error:', error)
      return legacyManifestJson(
        { error: 'Failed to create manifest' },
        { status: 500 }
      )
    }

    // Auto-enrich if property address is provided
    const manifestId = data.id
    const propertyAddress = input.propertyAddress
    const propertyCity = input.propertyCity
    const propertyState = input.propertyState
    const propertyZip = input.propertyZip
    let propertyCounty = input.propertyCounty

    if (propertyAddress && propertyState) {
      // Detect county if not provided
      if (!propertyCounty) {
        const detected = detectCounty(propertyCity, propertyState, propertyZip)
        if (detected) {
          propertyCounty = detected.county
        }
      }

      // Enrich if county is available
      if (propertyCounty) {
        try {
          // Enrich manifest with county data
          manifest = await enrichManifestProperty(
            manifest,
            propertyAddress,
            propertyCity,
            propertyState,
            propertyZip,
            propertyCounty
          )

          // Score manifest
          const { score, tier } = scoreManifest(manifest)

          // Update manifest object with score and tier
          manifest.qualificationScore = score
          manifest.tier = tier as ManifestV2['tier']

          // Update manifest via V2.1 write path. Every top-level key of the
          // freshly-enriched manifest is passed as a subtree — the RPC
          // shallow-replaces each and writes a manifest_history row.
          try {
            const { updateManifestV2_1 } = await import('@/lib/manifest-sync')
            const subtrees: Record<string, unknown> = {}
            for (const key of Object.keys(manifest)) {
              subtrees[key] = (manifest as unknown as Record<string, unknown>)[key]
            }
            await updateManifestV2_1({
              manifestId,
              subtrees,
              actor: 'system',
              reason: 'api:manifests_post_enrichment',
            })
          } catch (updateErr) {
            console.error('Manifest enrichment update error:', updateErr)
          }

          // Also write enrichment data back to leads table so the CRM UI shows it
          if (input.leadId) {
            const prop = manifest.property || {}
            const dwell = prop.dwelling || {}
            const assess = prop.assessment || {}
            const leadUpdates: Record<string, unknown> = {}
            if (dwell.bedrooms) leadUpdates.beds = dwell.bedrooms
            if (dwell.bathrooms) leadUpdates.baths_full = dwell.bathrooms
            if (dwell.sqft) leadUpdates.sqft = dwell.sqft
            if (dwell.yearBuilt) leadUpdates.year_built = dwell.yearBuilt
            if (assess.appraisedTotal) leadUpdates.arv = assess.appraisedTotal
            if (assess.assessedTotal) leadUpdates.assessed_value = assess.assessedTotal
            if (dwell.propertyType) leadUpdates.property_type = dwell.propertyType === 'SF' ? 'Single Family' : dwell.propertyType
            if (dwell.basement) leadUpdates.basement_type = dwell.basement
            if (propertyCounty) { leadUpdates.data_source = `${propertyCounty.toLowerCase()}_county_assessor`; leadUpdates.data_enriched_at = new Date().toISOString() }

            if (Object.keys(leadUpdates).length > 0) {
              const { error: leadErr } = await supabase.from('leads').update(leadUpdates).eq('id', input.leadId)
              if (leadErr) console.error('Lead update failed:', leadErr)
            }
          }
        } catch (enrichErr) {
          console.error('Manifest enrichment failed:', enrichErr)
          // Don't fail the request, enrichment is optional
        }
      }
    }

    return legacyManifestJson({
      success: true,
      manifest: manifest,
      id: manifestId,
      qualificationScore: manifest.qualificationScore,
      tier: manifest.tier,
    })
  } catch (err) {
    console.error('Manifests POST error:', err)
    return legacyManifestJson(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
