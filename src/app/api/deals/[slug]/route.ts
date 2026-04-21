export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

// ---------------------------------------------------------------------------
// GET /api/deals/:slug (PUBLIC)
// Return deal page data + lead property details for public display.
// Increments view_count. Excludes sensitive fields.
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const db = supabaseAdmin()

    // Fetch deal page
    const { data: dealPage, error } = await db
      .from('deal_pages')
      .select('*')
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    if (error || !dealPage) {
      return NextResponse.json(
        { error: 'Deal not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    // Fetch lead property details (only public-safe fields)
    const { data: lead } = await db
      .from('leads')
      .select(
        'property_address, city, state, zip, county, property_type, beds, baths_full, sqft, arv, offer_amount, lot_size, year_built'
      )
      .eq('id', dealPage.lead_id)
      .single()

    // Increment view count (fire-and-forget)
    db.from('deal_pages')
      .update({ view_count: (dealPage.view_count || 0) + 1 })
      .eq('id', dealPage.id)
      .then(({ error: viewErr }) => {
        if (viewErr) console.error('[deals/:slug] View count update failed:', viewErr)
      })

    // Build public response (strip sensitive fields)
    const publicDeal = {
      id: dealPage.id,
      slug: dealPage.slug,
      title: dealPage.title,
      description: dealPage.description,
      photos: dealPage.photos,
      is_active: dealPage.is_active,
      show_address: dealPage.show_address,
      show_arv: dealPage.show_arv,
      show_asking_price: dealPage.show_asking_price,
      show_assignment_fee: dealPage.show_assignment_fee,
      accept_offers: dealPage.accept_offers,
      requires_registration: dealPage.requires_registration,
      view_count: (dealPage.view_count || 0) + 1,
      created_at: dealPage.created_at,
    }

    // Public lead info (no seller info, no assignment_fee, etc.)
    const publicLead = lead
      ? {
          property_address: lead.property_address,
          city: lead.city,
          state: lead.state,
          zip: lead.zip,
          county: lead.county,
          property_type: lead.property_type,
          beds: lead.beds,
          baths_full: lead.baths_full,
          sqft: lead.sqft,
          arv: lead.arv,
          asking_price: lead.offer_amount,
          lot_size: lead.lot_size,
          year_built: lead.year_built,
        }
      : null

    return NextResponse.json(
      { deal: publicDeal, property: publicLead },
      { headers: corsHeaders }
    )
  } catch (err) {
    console.error('[deals/:slug GET] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
