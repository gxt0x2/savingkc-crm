import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** GET /api/sc/call-scripts — list scripts, newest first. */
export async function GET() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('sc_call_scripts')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ scripts: data || [] })
}

/** POST /api/sc/call-scripts — { name, body } create. */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const { name, body } = await req.json().catch(() => ({}))
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 })
  const { data, error } = await db
    .from('sc_call_scripts')
    .insert({ name: name.trim(), body: (body ?? '').trim() })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ script: data })
}

/** PATCH /api/sc/call-scripts — { id, name?, body? } update. */
export async function PATCH(req: Request) {
  const db = supabaseAdmin()
  const { id, name, body } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (typeof name === 'string') patch.name = name.trim()
  if (typeof body === 'string') patch.body = body.trim()
  const { data, error } = await db
    .from('sc_call_scripts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ script: data })
}

/** DELETE /api/sc/call-scripts?id=… */
export async function DELETE(req: Request) {
  const db = supabaseAdmin()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { error } = await db.from('sc_call_scripts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
