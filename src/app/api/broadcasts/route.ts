export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { matchBuyersToDeal } from '@/lib/buyer-matching'

// ---------------------------------------------------------------------------
// GET /api/broadcasts?lead_id=xxx
// List broadcasts, optionally filtered by lead_id. Joined with lead info.
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const leadId = searchParams.get('lead_id')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    let query = supabaseAdmin()
      .from('deal_broadcasts')
      .select(
        '*, leads:lead_id(id, property_address, city, state, zip, arv, offer_amount)',
        { count: 'exact' }
      )
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (leadId) {
      query = query.eq('lead_id', leadId)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[broadcasts GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ broadcasts: data ?? [], total: count ?? 0 })
  } catch (err) {
    console.error('[broadcasts GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/broadcasts
// Create a draft broadcast. Runs buyer matching, inserts broadcast + recipients.
// Body: { lead_id, broadcast_type? }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { lead_id, broadcast_type } = body

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // Fetch lead data to build deal_snapshot
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

    // Build deal snapshot from lead fields
    const deal_snapshot = {
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

    // Run buyer matching
    const matches = await matchBuyersToDeal(lead_id)

    // Insert broadcast record
    const { data: broadcast, error: broadcastError } = await db
      .from('deal_broadcasts')
      .insert({
        lead_id,
        broadcast_type: broadcast_type || 'sms_email',
        status: 'draft',
        deal_snapshot,
        total_recipients: matches.length,
        sms_sent: 0,
        emails_sent: 0,
        offers_received: 0,
      })
      .select()
      .single()

    if (broadcastError) {
      console.error('[broadcasts POST] Insert broadcast error:', broadcastError)
      return NextResponse.json({ error: broadcastError.message }, { status: 500 })
    }

    // Insert broadcast recipients
    if (matches.length > 0) {
      const recipients = matches.map(m => ({
        broadcast_id: broadcast.id,
        buyer_id: m.buyer_id,
        match_score: m.score,
        match_reasons: m.reasons,
        sms_status: 'pending' as const,
        email_status: 'pending' as const,
      }))

      const { error: recipError } = await db
        .from('broadcast_recipients')
        .insert(recipients)

      if (recipError) {
        console.error('[broadcasts POST] Insert recipients error:', recipError)
        // Don't fail the whole request - broadcast was created
      }
    }

    return NextResponse.json({ broadcast, matches }, { status: 201 })
  } catch (err) {
    console.error('[broadcasts POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
