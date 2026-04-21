export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { validateInput, createBuyerSchema } from '@/lib/validation-schemas'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

// ---------------------------------------------------------------------------
// GET /api/buyers
// List buyers with pagination, search, and filters
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit
    const status = searchParams.get('status')
    const tier = searchParams.get('tier')
    const search = searchParams.get('search')
    const tag = searchParams.get('tag')

    let query = supabaseAdmin()
      .from('buyers')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (status) {
      query = query.eq('status', status)
    }

    if (tier) {
      query = query.eq('tier', tier)
    }

    if (search) {
      query = query.or(
        `first_name.ilike.%${search}%,last_name.ilike.%${search}%,company_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
      )
    }

    if (tag) {
      query = query.contains('tags', [tag])
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[buyers GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ buyers: data ?? [], total: count ?? 0 })
  } catch (err) {
    console.error('[buyers GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/buyers
// Create a new buyer
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const validation = validateInput(createBuyerSchema, body)

    if (!validation.success) {
      return NextResponse.json({ error: 'Validation failed', details: validation.errors }, { status: 400 })
    }

    const data = validation.data

    // Normalize phones to E.164
    const phone = data.phone ? normalizePhoneToE164(data.phone) : null
    const phone_2 = data.phone_2 ? normalizePhoneToE164(data.phone_2) : null

    const { data: buyer, error } = await supabaseAdmin()
      .from('buyers')
      .insert({
        ...data,
        phone,
        phone_2,
        tier: data.tier ?? 'new',
        status: 'active',
      })
      .select()
      .single()

    if (error) {
      console.error('[buyers POST] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ buyer }, { status: 201 })
  } catch (err) {
    console.error('[buyers POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/buyers
// Update buyer by id (id in body)
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...fields } = body

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    // Normalize phones if present
    if (fields.phone !== undefined) {
      fields.phone = fields.phone ? normalizePhoneToE164(fields.phone) : null
    }
    if (fields.phone_2 !== undefined) {
      fields.phone_2 = fields.phone_2 ? normalizePhoneToE164(fields.phone_2) : null
    }

    const { data: buyer, error } = await supabaseAdmin()
      .from('buyers')
      .update(fields)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[buyers PATCH] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ buyer })
  } catch (err) {
    console.error('[buyers PATCH] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/buyers
// Delete buyers by ids array (ids in body)
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
