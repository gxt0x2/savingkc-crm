export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
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

    // Fetch deal page — fixed: was .eq('status', 'active')
    const { data: dealPage, error } = await db
      .from('deal_pages')
      .select('*')
      .eq('slug', slug)
      .eq('is_active', true)
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
        'property_address, city, state, zip, county, property_type, beds, baths_full, baths_half, sqft, arv, offer_amount, lot_size, year_built'
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
      videos: dealPage.videos || [],
      inspection_reports: dealPage.inspection_reports || [],
      is_active: dealPage.is_active,
      show_address: dealPage.show_address,
      show_arv: dealPage.show_arv,
      show_asking_price: dealPage.show_asking_price,
      show_assignment_fee: dealPage.show_assignment_fee,
      accept_offers: dealPage.accept_offers,
      requires_registration: dealPage.requires_registration,
      view_count: (dealPage.view_count || 0) + 1,
      created_at: dealPage.created_at,
      // New contract/condition fields
      contract_close_date: dealPage.contract_close_date,
      earnest_money: dealPage.earnest_money,
      inspection_period_days: dealPage.inspection_period_days,
      financing_terms: dealPage.financing_terms,
      repair_estimate_low: dealPage.repair_estimate_low,
      repair_estimate_high: dealPage.repair_estimate_high,
      property_condition: dealPage.property_condition,
      parking: dealPage.parking,
      contract_notes: dealPage.contract_notes,
      assignment_fee: dealPage.assignment_fee,
    }

    // Public lead info (no seller info)
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
          baths_half: lead.baths_half,
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

// ---------------------------------------------------------------------------
// PATCH /api/deals/:slug (ADMIN)
// Update deal page fields. Accepts slug or ID.
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await req.json()
    const db = supabaseAdmin()

    // Allow updating by slug or by ID
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(slug)

    const allowedFields = [
      'title', 'description', 'photos', 'videos', 'inspection_reports',
      'show_address', 'show_arv', 'show_asking_price', 'show_assignment_fee',
      'accept_offers', 'requires_registration', 'is_active',
      'contract_close_date', 'earnest_money', 'inspection_period_days',
      'financing_terms', 'repair_estimate_low', 'repair_estimate_high',
      'property_condition', 'parking', 'contract_notes', 'assignment_fee',
      'asking_price', 'purchase_price',
    ]

    const updates: Record<string, unknown> = {}
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key]
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400, headers: corsHeaders })
    }

    let query = db.from('deal_pages').update(updates).select().single()
    if (isUuid) {
      query = db.from('deal_pages').update(updates).eq('id', slug).select().single()
    } else {
      query = db.from('deal_pages').update(updates).eq('slug', slug).select().single()
    }

    const { data, error } = await query

    if (error || !data) {
      return NextResponse.json(
        { error: error?.message || 'Deal not found' },
        { status: error ? 500 : 404, headers: corsHeaders }
      )
    }

    return NextResponse.json({ deal: data }, { headers: corsHeaders })
  } catch (err) {
    console.error('[deals/:slug PATCH] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
