export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// GET /api/vendors
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '100')
    const offset = (page - 1) * limit
    const search = searchParams.get('search')
    const category = searchParams.get('category')

    let query = supabaseAdmin()
      .from('vendors')
      .select('*', { count: 'exact' })
      .order('is_preferred', { ascending: false })
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1)

    if (search) {
      query = query.or(
        `name.ilike.%${search}%,company_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
      )
    }

    if (category && category !== 'all') {
      query = query.eq('category', category)
    }

    const { data, error, count } = await query

    if (error) {
      console.error('[vendors GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ vendors: data ?? [], total: count ?? 0 })
  } catch (err) {
    console.error('[vendors GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/vendors
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (!body.name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 })
    }
    if (!body.category) {
      return NextResponse.json({ error: 'Category is required' }, { status: 400 })
    }

    const { data: row, error } = await supabaseAdmin()
      .from('vendors')
      .insert({
        name: body.name.trim(),
        company_name: body.company_name?.trim() || null,
        category: body.category,
        phone: body.phone?.trim() || null,
        phone_2: body.phone_2?.trim() || null,
        email: body.email?.trim() || null,
        website: body.website?.trim() || null,
        address: body.address?.trim() || null,
        service_areas: body.service_areas ?? [],
        notes: body.notes?.trim() || null,
        rating: body.rating ? parseInt(body.rating) : null,
        is_preferred: body.is_preferred ?? false,
        status: body.status ?? 'active',
        tags: body.tags ?? [],
      })
      .select()
      .single()

    if (error) {
      console.error('[vendors POST] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ vendor: row }, { status: 201 })
  } catch (err) {
    console.error('[vendors POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// PATCH /api/vendors
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...fields } = body

    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400 })
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updates: Record<string, any> = {}
    const allowed = [
      'name', 'company_name', 'category', 'phone', 'phone_2', 'email',
      'website', 'address', 'service_areas', 'notes', 'rating',
      'is_preferred', 'status', 'tags',
    ]
    for (const key of allowed) {
      if (key in fields) {
        updates[key] = fields[key]
      }
    }
    updates.updated_at = new Date().toISOString()

    const { data: row, error } = await supabaseAdmin()
      .from('vendors')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[vendors PATCH] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ vendor: row })
  } catch (err) {
    console.error('[vendors PATCH] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/vendors
// ---------------------------------------------------------------------------
export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { ids } = body

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: 'ids array required' }, { status: 400 })
    }

    const { error, count } = await supabaseAdmin()
      .from('vendors')
      .delete({ count: 'exact' })
      .in('id', ids)

    if (error) {
      console.error('[vendors DELETE] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ deleted: count ?? ids.length })
  } catch (err) {
    console.error('[vendors DELETE] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
