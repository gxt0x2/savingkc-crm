export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/buyers/:id
// Single buyer with engagement stats from broadcast_recipients
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    // Fetch buyer record
    const { data: buyer, error: buyerError } = await supabaseAdmin()
      .from('buyers')
      .select('*')
      .eq('id', id)
      .single()

    if (buyerError) {
      if (buyerError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Buyer not found' }, { status: 404 })
      }
      console.error('[buyers/:id GET] Supabase buyer error:', buyerError)
      return NextResponse.json({ error: buyerError.message }, { status: 500 })
    }

    // Fetch engagement history from broadcast_recipients
    const { data: recipients, error: recipientsError } = await supabaseAdmin()
      .from('broadcast_recipients')
      .select('id, broadcast_id, sms_status, sms_replied, created_at')
      .eq('buyer_id', id)

    if (recipientsError) {
      console.error('[buyers/:id GET] Supabase recipients error:', recipientsError)
    }

    const rows = recipients ?? []

    // Count offers separately
    const { count: offersCount } = await supabaseAdmin()
      .from('buyer_offers')
      .select('id', { count: 'exact', head: true })
      .eq('buyer_id', id)

    const stats = {
      broadcasts_received: rows.length,
      sms_replies: rows.filter((r) => r.sms_replied).length,
      offers_submitted: offersCount ?? 0,
    }

    return NextResponse.json({ buyer, stats })
  } catch (err) {
    console.error('[buyers/:id GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
