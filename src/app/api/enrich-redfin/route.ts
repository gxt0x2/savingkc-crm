import { NextRequest, NextResponse } from 'next/server'
import { enrichFromRedfin, RedfinInput } from '@/lib/redfin-enrichment'
import { supabase } from '@/lib/supabase-lazy'
import { requireUserOrSecret } from '@/lib/api/admin-auth'

export const runtime = 'nodejs'
export const maxDuration = 60

// POST /api/enrich-redfin — Add Redfin estimate to the manifest financials.
export async function POST(req: NextRequest) {
  const unauthorized = await requireUserOrSecret(req)
  if (unauthorized) return unauthorized

  try {
    const body = await req.json()
    const { leadId, address, city, state, zip } = body

    let lead: any
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

    // Update manifest if we have one and got an estimate
    if (leadId && result.success && result.redfinEstimate) {
      try {
        const { updateManifestV2_1 } = await import('@/lib/manifest-sync')
        await updateManifestV2_1({
          leadId,
          compute: (current: any) => ({
            financials: {
              ...(current.financials ?? {}),
              redfin_estimate: result.redfinEstimate,
            },
            auditTrail: [
              ...(current.auditTrail ?? []),
              {
                timestamp: new Date().toISOString(),
                agent: 'system:redfin_enrichment',
                action: 'redfin_supplement_complete',
                details: { estimate: result.redfinEstimate, url: result.url, source: 'redfin' },
              },
            ],
            ariIntelligence: {
              ...(current.ariIntelligence ?? {}),
              briefingStale: true,
            },
          }),
          actor: 'system',
          reason: 'api:enrich-redfin',
        })
      } catch (err) {
        console.log('[Redfin Enrich] Manifest update failed:', err)
      }
    }

    return NextResponse.json(result)
  } catch (err: any) {
    console.error('[Redfin Enrich] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: err?.message || 'Unexpected error', source: 'redfin' },
      { status: 500 }
    )
  }
}
