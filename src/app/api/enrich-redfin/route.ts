import { NextRequest, NextResponse } from 'next/server'
import { enrichFromRedfin, RedfinInput } from '@/lib/redfin-enrichment'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

interface RedfinRequestBody {
  leadId?: string
  address?: string
  city?: string
  state?: string
  zip?: string
}

interface RedfinLeadContext {
  id?: string
  property_address?: string | null
  address?: string | null
  city?: string | null
  state?: string | null
  zip?: string | null
  full_name?: string | null
}

// POST /api/enrich-redfin — Add a Redfin estimate to the canonical property.
export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json() as RedfinRequestBody
    const { leadId, address, city, state, zip } = body

    let lead: RedfinLeadContext
    if (leadId) {
      const { data, error } = await supabase
        .from('leads')
        .select('id, property_address, city, state, zip, full_name')
        .eq('id', leadId)
        .single()
      if (error || !data) {
        return NextResponse.json(
          { success: false, error: `Lead not found: ${error?.message || 'unknown'}` },
          { status: 404 }
        )
      }
      lead = data
    } else if (address && city && state) {
      lead = { property_address: address, city, state, zip }
    } else {
      return NextResponse.json(
        { success: false, error: 'leadId or address/city/state required' },
        { status: 400 }
      )
    }

    const resolvedAddress: string | null = lead.property_address || lead.address || null
    if (!resolvedAddress || !lead.city || !lead.state) {
      return NextResponse.json(
        { success: false, error: 'Lead missing address information' },
        { status: 400 }
      )
    }

    const input: RedfinInput = {
      address: resolvedAddress,
      city: lead.city,
      state: lead.state,
      zip: lead.zip || undefined,
    }

    const result = await enrichFromRedfin(input)

    // Persist provider output to the canonical property before reporting success.
    if (leadId && result.success && result.redfinEstimate) {
      const { error: canonicalError } = await supabase.rpc('update_crm_property_enrichment_v1', {
        p_lead_id: leadId,
        p_redfin_estimate: result.redfinEstimate,
        p_source: 'redfin',
        p_fetched_at: result.fetchedAt ?? new Date().toISOString(),
      })
      if (canonicalError) {
        console.error('[Redfin Enrich] Canonical property update failed:', canonicalError.message)
        return NextResponse.json({
          success: false,
          error: 'Redfin data was retrieved but could not be saved to the canonical property.',
          retryable: true,
        }, { status: 503 })
      }
    }

    return NextResponse.json(result)
  } catch (err: unknown) {
    console.error('[Redfin Enrich] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : 'Unexpected error', source: 'redfin' },
      { status: 500 }
    )
  }
}
