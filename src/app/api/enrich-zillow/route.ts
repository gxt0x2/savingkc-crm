import { NextRequest, NextResponse } from 'next/server'
import { enrichFromZillow, ZillowInput } from '@/lib/zillow-enrichment'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/enrich-zillow — Supplement county data with Zillow
export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json()
    const { leadId, address, city, state, zip } = body

    // Allow either leadId OR direct address data
    let lead: any
    let shouldUpdateDb = false

    if (leadId) {
      // Fetch lead data from database
      const { data: leadData, error: leadError } = await supabase
        .from('leads')
        .select('id, property_address, city, state, zip, full_name, year_built')
        .eq('id', leadId)
        .single()

      if (leadError || !leadData) {
        console.error('[Zillow Enrich] Lead not found in DB:', leadId, leadError)

        // If we have address data in the request, use it anyway
        if (address && city && state) {
          lead = { id: leadId, address, city, state, zip, full_name: 'Lead' }
          shouldUpdateDb = true
        } else {
          return NextResponse.json(
            { success: false, error: `Lead not found: ${leadError?.message || 'Unknown error'}` },
            { status: 404 }
          )
        }
      } else {
        lead = leadData
        shouldUpdateDb = true
      }
    } else if (address && city && state) {
      // Direct address mode (no database update)
      lead = { address, city, state, zip }
      shouldUpdateDb = false
    } else {
      return NextResponse.json(
        { success: false, error: 'Missing leadId or address information' },
        { status: 400 }
      )
    }

    // Normalize — DB rows use `property_address`, direct-address mode uses `address`.
    const resolvedAddress: string | null = lead.property_address || lead.address || null

    if (!resolvedAddress || !lead.city || !lead.state) {
      return NextResponse.json(
        { success: false, error: 'Lead is missing address information' },
        { status: 400 }
      )
    }

    console.log(`[Zillow Enrich] Starting for ${lead.full_name || resolvedAddress}: ${resolvedAddress}, ${lead.city}, ${lead.state}`)

    // Run Zillow enrichment
    const input: ZillowInput = {
      address: resolvedAddress,
      city: lead.city,
      state: lead.state,
      zip: lead.zip || undefined,
    }

    const result = await enrichFromZillow(input)

    if (!result.success) {
      return NextResponse.json(result, { status: 200 }) // Return error but 200 so UI can handle gracefully
    }

    // Update lead with Zillow data (only if we have a leadId and should update)
    if (shouldUpdateDb && leadId) {
      const updates: any = {
        data_source: 'zillow_supplement', // Mark as supplemented
        data_enriched_at: result.fetchedAt,
      }

      if (result.lotSizeSqft) updates.lot_size = result.lotSizeSqft
      if (result.lastSaleDate) updates.last_sale_date = result.lastSaleDate
      if (result.lastSalePrice) updates.last_sale_price = result.lastSalePrice
      if (result.taxAssessment) updates.tax_assessment = result.taxAssessment
      if (result.yearBuilt && !lead.year_built) updates.year_built = result.yearBuilt

      const { error: updateError } = await supabase
        .from('leads')
        .update(updates)
        .eq('id', leadId)

      if (updateError) {
        console.error('[Zillow Enrich] Failed to update lead:', updateError)
        return NextResponse.json({
          ...result,
          updateError: updateError.message,
        })
      }

      // Also update manifest if it exists
      try {
        const { data: manifestRow } = await supabase
          .from('manifests')
          .select('id')
          .eq('lead_id', leadId)
          .single()

        if (manifestRow) {
          await updateManifestWithZillow(manifestRow.id, result)
        }
      } catch (manifestErr) {
        console.log('[Zillow Enrich] No manifest to update or update failed:', manifestErr)
        // Non-fatal, continue
      }
    }

    console.log(`[Zillow Enrich] Success for ${lead.full_name || resolvedAddress}`)

    return NextResponse.json({
      ...result,
      updated: shouldUpdateDb,
      leadId: lead.id || null,
    })

  } catch (err: any) {
    console.error('[Zillow Enrich] API error:', err)
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
 * Update manifest with Zillow supplemental data
 */
async function updateManifestWithZillow(manifestId: string, zillow: any) {
  const { data: row } = await supabase
    .from('manifests')
    .select('lead_id')
    .eq('id', manifestId)
    .single()

  if (!row?.lead_id) throw new Error('Manifest not found')

  const { updateManifestAndCascade } = await import('@/lib/manifest-sync')

  await updateManifestAndCascade(row.lead_id, (manifest: any) => {
    // Update property details
    if (zillow.lotSizeSqft) {
      if (!manifest.property.lot) manifest.property.lot = {}
      manifest.property.lot.sizeSqft = zillow.lotSizeSqft
      manifest.property.lot.sizeAcres = zillow.lotSizeAcres || zillow.lotSizeSqft / 43560
    }

    if (zillow.lastSaleDate || zillow.lastSalePrice) {
      if (!manifest.property.sales) manifest.property.sales = {}
      manifest.property.sales.lastSaleDate = zillow.lastSaleDate
      manifest.property.sales.lastSalePrice = zillow.lastSalePrice
    }

    if (zillow.taxAssessment) {
      if (!manifest.property.assessment) manifest.property.assessment = {}
      manifest.property.assessment.totalValue = zillow.taxAssessment
    }

    if (zillow.zestimate) {
      if (!manifest.financials) manifest.financials = {}
      manifest.financials.zillow_zestimate = zillow.zestimate
    }

    // Add audit trail
    manifest.auditTrail.push({
      timestamp: new Date().toISOString(),
      agent: 'system:zillow_enrichment',
      action: 'zillow_supplement_complete',
      details: {
        fieldsAdded: Object.keys(zillow).filter(k => zillow[k] !== undefined && zillow[k] !== null),
        source: 'zillow'
      },
    })

    // Mark briefing as stale so it regenerates with new data
    if (!manifest.ariIntelligence) manifest.ariIntelligence = {}
    manifest.ariIntelligence.briefingStale = true
  }, 'api:enrich-zillow')
}
