export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

const VALID_STAGES = ['new', 'marketing', 'offers_in', 'negotiating', 'under_contract', 'closed', 'dead']

// ---------------------------------------------------------------------------
// GET /api/dispo-deals/:id
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const db = supabaseAdmin()

    const { data: deal, error } = await db
      .from('dispo_deals')
      .select(
        '*, leads:lead_id(id, full_name, property_address, city, state, zip, arv, offer_amount, property_type, beds, baths_full, sqft)'
      )
      .eq('id', id)
      .single()

    if (error || !deal) {
      return NextResponse.json({ error: 'Dispo deal not found' }, { status: 404 })
    }

    // Enrich with related data
    const { data: dealPage } = await db
      .from('deal_pages')
      .select('id, slug, is_active, view_count')
      .eq('lead_id', deal.lead_id)
      .limit(1)
      .maybeSingle()

    const { data: broadcasts } = await db
      .from('deal_broadcasts')
      .select('id, status, sent_at, total_recipients, sms_sent, emails_sent, offers_received')
      .eq('lead_id', deal.lead_id)
      .order('created_at', { ascending: false })

    const { data: offers } = await db
      .from('buyer_offers')
      .select('id, offer_amount, status, buyer_id, buyers:buyer_id(id, first_name, last_name, company_name, name, company)')
      .eq('lead_id', deal.lead_id)
      .order('offer_amount', { ascending: false })

    return NextResponse.json({
      deal: {
        ...deal,
        deal_page: dealPage ?? null,
        broadcasts: broadcasts ?? [],
        offers: offers ?? [],
      },
    })
  } catch (err) {
    console.error('[dispo-deals/:id GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/dispo-deals/:id
// Update stage, assignment_fee, close_date, accepted_offer_id, etc.
// ---------------------------------------------------------------------------
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json()
    const db = supabaseAdmin()

    // Fetch current deal
    const { data: current, error: fetchError } = await db
      .from('dispo_deals')
      .select('id, stage')
      .eq('id', id)
      .single()

    if (fetchError || !current) {
      return NextResponse.json({ error: 'Dispo deal not found' }, { status: 404 })
    }

    // Build update payload
    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    }

    if (body.stage !== undefined) {
      if (!VALID_STAGES.includes(body.stage)) {
        return NextResponse.json(
          { error: `Invalid stage. Must be one of: ${VALID_STAGES.join(', ')}` },
          { status: 400 }
        )
      }
      updates.stage = body.stage
    }

    if (body.assignment_fee !== undefined) updates.assignment_fee = body.assignment_fee
    if (body.close_date !== undefined) updates.close_date = body.close_date
    if (body.accepted_offer_id !== undefined) updates.accepted_offer_id = body.accepted_offer_id
    if (body.accepted_buyer_id !== undefined) updates.accepted_buyer_id = body.accepted_buyer_id
    if (body.notes !== undefined) updates.notes = body.notes

    const { data: deal, error: updateError } = await db
      .from('dispo_deals')
      .update(updates)
      .eq('id', id)
      .select(
        '*, leads:lead_id(id, full_name, property_address, city, state, zip, arv, offer_amount)'
      )
      .single()

    if (updateError) {
      console.error('[dispo-deals/:id PATCH] Update error:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ deal })
  } catch (err) {
    console.error('[dispo-deals/:id PATCH] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
