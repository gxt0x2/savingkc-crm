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
        '*, buyer:buyer_id(id, name, company, email, phone), lead:lead_id(id, property_address, city, state, zip, arv, offer_amount, full_name), deal_page:deal_page_id(id, slug, title)',
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
        '*, buyer:buyer_id(id, name, company, email, phone), lead:lead_id(id, property_address, city, full_name)'
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

// ---------------------------------------------------------------------------
// POST /api/offers — manually create an offer from the CRM
// Body: {
//   lead_id, offer_amount,
//   deal_page_id?, buyer_id?,
//   buyer_name?, buyer_phone?, buyer_email?, buyer_company?,
//   earnest_money?, close_days?, inspection_days?, financing_type?, notes?,
//   status? (default 'pending')
// }
// If buyer_id is not provided, resolves or creates a buyer from name/phone/email.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const {
      lead_id,
      deal_page_id,
      offer_amount,
      earnest_money,
      close_days,
      inspection_days,
      financing_type,
      notes,
      status,
      buyer_id: bodyBuyerId,
      buyer_name,
      buyer_phone,
      buyer_email,
      buyer_company,
    } = body

    if (!lead_id) return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
    if (offer_amount == null || Number(offer_amount) <= 0) {
      return NextResponse.json({ error: 'offer_amount required' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // Verify lead exists
    const { data: lead, error: leadErr } = await db
      .from('leads')
      .select('id')
      .eq('id', lead_id)
      .single()
    if (leadErr || !lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    // Resolve buyer: explicit buyer_id > phone match > email match > new buyer
    let buyerId: string | null = bodyBuyerId || null

    if (!buyerId && buyer_phone) {
      const normalized = String(buyer_phone).replace(/\D/g, '')
      const e164 = normalized.length === 10 ? `+1${normalized}` : normalized.length === 11 ? `+${normalized}` : null
      if (e164) {
        const { data } = await db.from('buyers').select('id').eq('phone', e164).limit(1).single()
        if (data) buyerId = data.id
      }
    }
    if (!buyerId && buyer_email) {
      const { data } = await db.from('buyers').select('id').eq('email', String(buyer_email).toLowerCase()).limit(1).single()
      if (data) buyerId = data.id
    }

    if (!buyerId) {
      if (!buyer_name) {
        return NextResponse.json({ error: 'buyer_id or buyer_name required' }, { status: 400 })
      }
      const normalized = buyer_phone ? String(buyer_phone).replace(/\D/g, '') : ''
      const e164 = normalized.length === 10 ? `+1${normalized}` : normalized.length === 11 ? `+${normalized}` : null

      const { data: newBuyer, error: createErr } = await db
        .from('buyers')
        .insert({
          name: String(buyer_name).trim(),
          company: buyer_company || null,
          phone: e164,
          email: buyer_email ? String(buyer_email).toLowerCase() : null,
        })
        .select('id')
        .single()
      if (createErr) {
        console.error('[offers POST] Create buyer error:', createErr)
        return NextResponse.json({ error: 'Failed to create buyer' }, { status: 500 })
      }
      buyerId = newBuyer.id
    }

    // Resolve deal_page_id: use provided OR look up by lead_id
    let dealPageId: string | null = deal_page_id || null
    if (!dealPageId) {
      const { data: dp } = await db
        .from('deal_pages')
        .select('id')
        .eq('lead_id', lead_id)
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      if (dp) dealPageId = dp.id
    }

    const { data: offer, error: insertErr } = await db
      .from('buyer_offers')
      .insert({
        deal_page_id: dealPageId,
        lead_id,
        buyer_id: buyerId,
        offer_amount: Number(offer_amount),
        earnest_money: earnest_money != null ? Number(earnest_money) : null,
        close_days: close_days != null ? Number(close_days) : null,
        inspection_days: inspection_days != null ? Number(inspection_days) : null,
        financing_type: financing_type || null,
        notes: notes || null,
        status: status || 'pending',
      })
      .select(
        '*, buyer:buyer_id(id, name, company, email, phone), lead:lead_id(id, property_address, city, full_name)'
      )
      .single()

    if (insertErr) {
      console.error('[offers POST] Insert error:', insertErr)
      return NextResponse.json({ error: insertErr.message }, { status: 500 })
    }

    return NextResponse.json({ offer }, { status: 201 })
  } catch (err) {
    console.error('[offers POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
