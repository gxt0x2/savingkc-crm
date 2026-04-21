export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// Same adapter as the main buyers route
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dbRowToBuyer(row: any) {
  const nameParts = (row.name ?? '').split(' ')
  const firstName = row.first_name ?? nameParts[0] ?? ''
  const lastName = row.last_name ?? nameParts.slice(1).join(' ') ?? ''

  return {
    id: row.id,
    first_name: firstName,
    last_name: lastName,
    company_name: row.company_name ?? row.company ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    phone_2: row.phone_2 ?? null,
    buy_box: row.buy_box ?? {
      cities: row.areas ?? [],
      price_min: row.min_price ?? undefined,
      price_max: row.max_price ?? undefined,
      property_types: row.property_types ?? [],
    },
    funding_type: row.funding_type ?? null,
    max_purchase_price: row.max_purchase_price ?? row.max_price ?? null,
    monthly_capacity: row.monthly_capacity ?? null,
    avg_close_days: row.avg_close_days ?? row.avg_days_to_close ?? null,
    proof_of_funds: row.proof_of_funds ?? row.cash_verified ?? false,
    status: row.status ?? 'active',
    tier: row.tier ?? (row.notes?.toLowerCase?.().includes('vip') ? 'vip' : 'new'),
    source: row.source ?? null,
    deals_closed: row.deals_closed ?? row.past_purchases ?? 0,
    last_deal_date: row.last_deal_date ?? null,
    sms_opted_in: row.sms_opted_in ?? true,
    email_opted_in: row.email_opted_in ?? true,
    preferred_contact: row.preferred_contact ?? row.preferred_contact_method ?? 'sms',
    notes: row.notes ?? null,
    tags: row.tags ?? [],
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

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

    const { data: row, error: buyerError } = await supabaseAdmin()
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

    const buyer = dbRowToBuyer(row)

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
