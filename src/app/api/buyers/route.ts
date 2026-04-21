export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

// ---------------------------------------------------------------------------
// Schema adapter: the DB buyers table has the OLD columns (name, company,
// areas, min_price, max_price, etc.).  The front-end expects the NEW shape
// (first_name, last_name, buy_box, status, tier …).
// We transform on read and reverse-transform on write.
// ---------------------------------------------------------------------------
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

// Reverse-map new field names to old DB columns for inserts/updates
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buyerToDbRow(data: any) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row: any = {}

  // Name → stored as single 'name' column
  if (data.first_name !== undefined || data.last_name !== undefined) {
    row.name = `${data.first_name ?? ''} ${data.last_name ?? ''}`.trim()
  }
  if (data.company_name !== undefined) row.company = data.company_name
  if (data.email !== undefined) row.email = data.email
  if (data.phone !== undefined) row.phone = data.phone
  if (data.notes !== undefined) row.notes = data.notes

  // Buy box → flatten to old columns
  if (data.buy_box) {
    if (data.buy_box.cities) row.areas = data.buy_box.cities
    if (data.buy_box.price_min !== undefined) row.min_price = data.buy_box.price_min
    if (data.buy_box.price_max !== undefined) row.max_price = data.buy_box.price_max
    if (data.buy_box.property_types) row.property_types = data.buy_box.property_types
  }

  if (data.proof_of_funds !== undefined) row.cash_verified = data.proof_of_funds
  if (data.deals_closed !== undefined) row.past_purchases = data.deals_closed
  if (data.preferred_contact !== undefined) row.preferred_contact_method = data.preferred_contact
  if (data.max_purchase_price !== undefined) row.max_price = data.max_purchase_price

  return row
}

// ---------------------------------------------------------------------------
// GET /api/buyers
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit
    const search = searchParams.get('search')

    let query = supabaseAdmin()
      .from('buyers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
      )
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[buyers GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const buyers = (data ?? []).map(dbRowToBuyer)
    return NextResponse.json({ buyers, total: count ?? 0 })
  } catch (err) {
    console.error('[buyers GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/buyers
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    // Basic validation
    if (!body.first_name?.trim() || !body.last_name?.trim()) {
      return NextResponse.json({ error: 'First and last name are required' }, { status: 400 })
    }

    const phone = body.phone ? normalizePhoneToE164(body.phone) : null
    const dbData = buyerToDbRow(body)
    dbData.phone = phone

    const { data: row, error } = await supabaseAdmin()
      .from('buyers')
      .insert(dbData)
      .select()
      .single()

    if (error) {
      console.error('[buyers POST] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ buyer: dbRowToBuyer(row) }, { status: 201 })
  } catch (err) {
    console.error('[buyers POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/buyers
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...fields } = body

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    if (fields.phone !== undefined) {
      fields.phone = fields.phone ? normalizePhoneToE164(fields.phone) : null
    }

    const dbData = buyerToDbRow(fields)
    // Pass through phone directly (already in fields → dbData doesn't map it)
    if (fields.phone !== undefined) dbData.phone = fields.phone

    const { data: row, error } = await supabaseAdmin()
      .from('buyers')
      .update(dbData)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[buyers PATCH] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ buyer: dbRowToBuyer(row) })
  } catch (err) {
    console.error('[buyers PATCH] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/buyers
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }

    const { error, count } = await supabaseAdmin()
      .from('buyers')
      .delete({ count: 'exact' })
      .in('id', ids)

    if (error) {
      console.error('[buyers DELETE] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ deleted: count ?? ids.length })
  } catch (err) {
    console.error('[buyers DELETE] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
