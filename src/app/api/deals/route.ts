export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import crypto from 'crypto'

// ---------------------------------------------------------------------------
// GET /api/deals
// List all deal pages with lead info joined
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    const { data, error, count } = await supabaseAdmin()
      .from('deal_pages')
      .select(
        '*, leads:lead_id(id, property_address, city, state, zip, arv, offer_amount)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (error) {
      console.error('[deals GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ pages: data ?? [], total: count ?? 0 })
  } catch (err) {
    console.error('[deals GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/deals
// Create a deal page. Body: { lead_id, title?, description?, photos? }
// Generates an 8-char random slug.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { lead_id, title, description, photos } = body

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // Fetch lead data to populate defaults
    const { data: lead, error: leadError } = await db
      .from('leads')
      .select(
        'id, property_address, city, state, zip, county, property_type, beds, baths_full, sqft, arv, offer_amount, lot_size, year_built'
      )
      .eq('id', lead_id)
      .single()

    if (leadError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Generate 8-char random slug (lowercase alphanumeric)
    const slug = crypto.randomBytes(6).toString('base64url').toLowerCase().slice(0, 8)

    const defaultTitle = lead.property_address
      ? `Investment Opportunity - ${lead.property_address}`
      : 'Investment Opportunity'

    const row = {
      lead_id,
      slug,
      title: title || defaultTitle,
      description: description || null,
      photos: photos || [],
      is_active: true,
      view_count: 0,
      unique_visitors: 0,
      show_address: body.show_address ?? true,
      show_arv: body.show_arv ?? true,
      show_asking_price: body.show_asking_price ?? true,
      show_assignment_fee: body.show_assignment_fee ?? false,
      accept_offers: body.accept_offers ?? true,
      requires_registration: body.requires_registration ?? false,
    }

    const { data: dealPage, error: insertError } = await db
      .from('deal_pages')
      .insert(row)
      .select()
      .single()

    if (insertError) {
      // Handle slug collision (extremely unlikely with 8 random chars)
      if (insertError.code === '23505' && insertError.message?.includes('slug')) {
        const retrySlug = crypto.randomBytes(6).toString('base64url').toLowerCase().slice(0, 8)
        const { data: retryPage, error: retryError } = await db
          .from('deal_pages')
          .insert({ ...row, slug: retrySlug })
          .select()
          .single()

        if (retryError) {
          console.error('[deals POST] Retry insert error:', retryError)
          return NextResponse.json({ error: retryError.message }, { status: 500 })
        }

        return NextResponse.json({ deal: retryPage }, { status: 201 })
      }

      console.error('[deals POST] Insert error:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    return NextResponse.json({ deal: dealPage }, { status: 201 })
  } catch (err) {
    console.error('[deals POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
