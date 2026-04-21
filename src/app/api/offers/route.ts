export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/offers?status=xxx
// List all offers with buyer + lead info. Optional status filter.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    let query = supabaseAdmin()
      .from('buyer_offers')
      .select(
        '*, buyers:buyer_id(id, first_name, last_name, company_name, email, phone, tier), leads:lead_id(id, property_address, city, state, zip, arv, offer_amount), deal_pages:deal_page_id(id, slug, title)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[offers GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ offers: data ?? [], total: count ?? 0 })
  } catch (err) {
    console.error('[offers GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/offers
// Update offer status. Body: { id, status, counter_amount?, counter_notes? }
// Sets reviewed_at and decided_at as appropriate.
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, status, counter_amount, counter_notes } = body

    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 })
    }

    if (!status) {
      return NextResponse.json({ error: 'status is required' }, { status: 400 })
    }

    const validStatuses = ['pending', 'reviewing', 'countered', 'accepted', 'rejected', 'expired']
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
        { status: 400 }
      )
    }

    const db = supabaseAdmin()

    // Fetch current offer to check it exists
    const { data: existing, error: fetchError } = await db
      .from('buyer_offers')
      .select('id, status')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }

    // Build update payload
    const updates: Record<string, unknown> = { status }
    const now = new Date().toISOString()

    // Set reviewed_at when moving from pending to any other status
    if (existing.status === 'pending' && status !== 'pending') {
      updates.reviewed_at = now
    }

    // Set decided_at for terminal statuses
    if (['accepted', 'rejected', 'expired'].includes(status)) {
      updates.decided_at = now
    }

    // Handle counter offer
    if (status === 'countered') {
      if (counter_amount != null) {
        updates.counter_amount = counter_amount
      }
      if (counter_notes != null) {
        updates.counter_notes = counter_notes
      }
    }

    const { data: offer, error: updateError } = await db
      .from('buyer_offers')
      .update(updates)
      .eq('id', id)
      .select(
        '*, buyers:buyer_id(id, first_name, last_name, company_name, email, phone), leads:lead_id(id, property_address, city)'
      )
      .single()

    if (updateError) {
      console.error('[offers PATCH] Supabase error:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ offer })
  } catch (err) {
    console.error('[offers PATCH] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
