export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// PATCH /api/offers/[id]
// Supports updating status (+ counter fields) and toggling is_top_pick.
// When is_top_pick is set true, all other offers on the same lead are
// demoted in the same transaction so exactly one top pick exists per
// property.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    const body = await req.json()
    const {
      status,
      counter_amount,
      counter_notes,
      is_top_pick,
      offer_amount,
      earnest_money,
      close_days,
      inspection_days,
      financing_type,
      notes,
    } = body

    const db = supabaseAdmin()

    const { data: existing, error: fetchError } = await db
      .from('buyer_offers')
      .select('id, status, lead_id')
      .eq('id', id)
      .single()

    if (fetchError || !existing) {
      return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    }

    const updates: Record<string, unknown> = {}
    const now = new Date().toISOString()

    if (status !== undefined) {
      const validStatuses = ['pending', 'submitted', 'reviewing', 'countered', 'accepted', 'rejected', 'expired', 'withdrawn']
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${validStatuses.join(', ')}` },
          { status: 400 }
        )
      }
      updates.status = status
      if (existing.status === 'pending' && status !== 'pending') {
        updates.reviewed_at = now
      }
      if (['accepted', 'rejected', 'expired'].includes(status)) {
        updates.decided_at = now
      }
      if (status === 'countered') {
        if (counter_amount != null) updates.counter_amount = counter_amount
        if (counter_notes != null) updates.counter_notes = counter_notes
      }
    }

    if (offer_amount !== undefined) {
      const n = Number(offer_amount)
      if (!Number.isFinite(n) || n <= 0) {
        return NextResponse.json({ error: 'offer_amount must be positive' }, { status: 400 })
      }
      updates.offer_amount = n
    }
    if (earnest_money !== undefined) {
      updates.earnest_money = earnest_money === null || earnest_money === '' ? null : Number(earnest_money)
    }
    if (close_days !== undefined) {
      updates.close_days = close_days === null || close_days === '' ? null : Number(close_days)
    }
    if (inspection_days !== undefined) {
      updates.inspection_days = inspection_days === null || inspection_days === '' ? null : Number(inspection_days)
    }
    if (financing_type !== undefined) {
      updates.financing_type = financing_type || null
    }
    if (notes !== undefined) {
      updates.notes = notes || null
    }

    if (is_top_pick !== undefined) {
      updates.is_top_pick = Boolean(is_top_pick)
      if (is_top_pick) {
        // Demote all other offers on this lead — only one top pick per property
        const { error: demoteErr } = await db
          .from('buyer_offers')
          .update({ is_top_pick: false })
          .eq('lead_id', existing.lead_id)
          .neq('id', id)
        if (demoteErr) {
          console.error('[offers PATCH] Demote others error:', demoteErr)
          return NextResponse.json({ error: demoteErr.message }, { status: 500 })
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
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
      console.error('[offers PATCH /:id] Supabase error:', updateError)
      return NextResponse.json({ error: updateError.message }, { status: 500 })
    }

    return NextResponse.json({ offer })
  } catch (err) {
    console.error('[offers PATCH /:id] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
