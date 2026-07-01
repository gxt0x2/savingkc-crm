import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/**
 * GET /api/sc/contacts?page=1&limit=50&search=&group_id=&status=active
 * Paginated contact list. Search matches name / phone / email.
 */
export async function GET(req: Request) {
  const db = supabaseAdmin()
  const url = new URL(req.url)
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1)
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 500)
  const search = (url.searchParams.get('search') || '').trim()
  const groupId = url.searchParams.get('group_id')
  const status = url.searchParams.get('status') || 'active'
  const from = (page - 1) * limit
  const to = from + limit - 1

  // Restrict to a group's members when group_id is present.
  let contactIds: string[] | null = null
  if (groupId) {
    const { data: members, error: memErr } = await db
      .from('sc_group_members')
      .select('contact_id')
      .eq('group_id', groupId)
    if (memErr) return NextResponse.json({ error: memErr.message }, { status: 500 })
    contactIds = (members || []).map((m) => m.contact_id)
    if (contactIds.length === 0) {
      return NextResponse.json({ contacts: [], total: 0, page })
    }
  }

  let q = db
    .from('sc_contacts')
    .select('*', { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(from, to)

  if (contactIds) q = q.in('id', contactIds)

  if (search) {
    const s = search.replace(/,/g, '')
    q = q.or(
      `first_name.ilike.%${s}%,last_name.ilike.%${s}%,phone.ilike.%${s}%,email.ilike.%${s}%`,
    )
  }

  const { data, count, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contacts: data || [], total: count || 0, page })
}

/**
 * POST /api/sc/contacts — create/upsert a contact by phone.
 * Body: { first_name, last_name, phone, email, address, city, state, zip, tags, custom_fields, group_id? }
 */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))

  const phone = normalizePhoneToE164(body.phone)
  if (!phone) {
    return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  }

  const row = {
    first_name: body.first_name || null,
    last_name: body.last_name || null,
    phone,
    email: body.email || null,
    address: body.address || null,
    city: body.city || null,
    state: body.state || null,
    zip: body.zip || null,
    tags: Array.isArray(body.tags) ? body.tags : [],
    custom_fields:
      body.custom_fields && typeof body.custom_fields === 'object' ? body.custom_fields : {},
    source: body.source || 'manual',
    status: 'active' as const,
  }

  const { data, error } = await db
    .from('sc_contacts')
    .upsert(row, { onConflict: 'phone' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Optionally add to a group and bump its count.
  if (body.group_id && data) {
    const { error: memErr } = await db
      .from('sc_group_members')
      .upsert(
        { group_id: body.group_id, contact_id: data.id },
        { onConflict: 'group_id,contact_id', ignoreDuplicates: true },
      )
    if (!memErr) {
      const { count } = await db
        .from('sc_group_members')
        .select('contact_id', { count: 'exact', head: true })
        .eq('group_id', body.group_id)
      await db
        .from('sc_groups')
        .update({ contact_count: count || 0 })
        .eq('id', body.group_id)
    }
  }

  return NextResponse.json({ contact: data })
}

/**
 * PATCH /api/sc/contacts — update a contact by id.
 * Body: { id, ...fields }
 */
export async function PATCH(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  if (!body.id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  const fields = [
    'first_name',
    'last_name',
    'email',
    'address',
    'city',
    'state',
    'zip',
    'tags',
    'custom_fields',
    'status',
  ]
  for (const f of fields) {
    if (f in body) patch[f] = body[f]
  }
  if ('phone' in body) {
    const phone = normalizePhoneToE164(body.phone)
    if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
    patch.phone = phone
  }

  const { data, error } = await db
    .from('sc_contacts')
    .update(patch)
    .eq('id', body.id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ contact: data })
}

/** DELETE /api/sc/contacts?id= — soft delete (status='deleted'). */
export async function DELETE(req: Request) {
  const db = supabaseAdmin()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { error } = await db
    .from('sc_contacts')
    .update({ status: 'deleted' })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
