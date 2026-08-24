import { NextRequest, NextResponse } from 'next/server'
import { enrichFromZillow, ZillowInput } from '@/lib/zillow-enrichment'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ZillowRequestBody {
  leadId?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}

interface ZillowLeadContext {
  id?: string
  property_address?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  full_name?: string | null
  year_built?: number | null
}

// POST /api/enrich-zillow — Supplement county data with Zillow
export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json() as ZillowRequestBody
    const { leadId, address, city, state, zip } = body

    // Allow either leadId OR direct address data
    let lead: ZillowLeadContext
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
      const updates: Record<string, unknown> = {
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

      const { error: canonicalError } = await supabase.rpc('update_crm_property_enrichment_v1', {
        p_lead_id: leadId,
        p_zestimate: result.zestimate ?? null,
        p_lot_size: result.lotSizeSqft ?? null,
        p_last_sale_date: result.lastSaleDate ?? null,
        p_last_sale_price: result.lastSalePrice ?? null,
        p_tax_assessment: result.taxAssessment ?? null,
        p_year_built: result.yearBuilt ?? null,
        p_source: 'zillow',
        p_fetched_at: result.fetchedAt ?? new Date().toISOString(),
      })
      if (canonicalError) {
        console.error('[Zillow Enrich] Canonical property update failed:', canonicalError.message)
        return NextResponse.json({
          success: false,
          error: 'Zillow data was retrieved but could not be saved to the canonical property.',
          retryable: true,
        }, { status: 503 })
      }
    }

    console.log(`[Zillow Enrich] Success for ${lead.full_name || resolvedAddress}`)

    return NextResponse.json({
      ...result,
      updated: shouldUpdateDb,
      leadId: lead.id || null,
    })

  } catch (err: unknown) {
    console.error('[Zillow Enrich] API error:', err)
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : 'Internal server error',
      },
      { status: 500 }
    )
  }
}
