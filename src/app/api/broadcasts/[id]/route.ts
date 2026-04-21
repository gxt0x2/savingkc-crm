export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/broadcasts/:id
// Return broadcast detail with recipients + buyer info
// ---------------------------------------------------------------------------
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const db = supabaseAdmin()

    // Fetch broadcast with lead info
    const { data: broadcast, error: bcError } = await db
      .from('broadcasts')
      .select(
        '*, leads:lead_id(id, property_address, city, state, zip, county, property_type, beds, baths_full, sqft, arv, offer_amount)'
      )
      .eq('id', id)
      .single()

    if (bcError || !broadcast) {
      return NextResponse.json({ error: 'Broadcast not found' }, { status: 404 })
    }

    // Fetch recipients with buyer info
    const { data: recipients, error: recipError } = await db
      .from('broadcast_recipients')
      .select(
        '*, buyers:buyer_id(id, first_name, last_name, company_name, email, phone, tier, sms_opted_in, email_opted_in)'
      )
      .eq('broadcast_id', id)
      .order('match_score', { ascending: false })

    if (recipError) {
      console.error('[broadcasts/:id GET] Recipients fetch error:', recipError)
    }

    return NextResponse.json({
      broadcast,
      recipients: recipients ?? [],
    })
  } catch (err) {
    console.error('[broadcasts/:id GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
