import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** GET /api/sc/groups — list groups, newest first. */
export async function GET() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('sc_groups')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ groups: data || [] })
}

/** POST /api/sc/groups — create a manual group { name, description }. */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  if (!body.name || !String(body.name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  }
  const { data, error } = await db
    .from('sc_groups')
    .insert({
      name: String(body.name).trim(),
      description: body.description || null,
      source: 'manual',
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ group: data })
}

/** DELETE /api/sc/groups?id= — delete a group (members cascade via FK). */
export async function DELETE(req: Request) {
  const db = supabaseAdmin()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { error } = await db.from('sc_groups').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
