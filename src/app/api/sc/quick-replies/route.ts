import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/** GET /api/sc/quick-replies — canned inbox snippets. */
export async function GET() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('sc_quick_replies')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ quickReplies: data || [] })
}

/** POST /api/sc/quick-replies — create { title, body }. */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const { title, body, sort_order } = await req.json().catch(() => ({}))
  if (!title?.trim() || !body?.trim()) {
    return NextResponse.json({ error: 'Missing title or body' }, { status: 400 })
  }
  const { data, error } = await db
    .from('sc_quick_replies')
    .insert({ title: title.trim(), body: body.trim(), sort_order: sort_order ?? 0 })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ quickReply: data })
}

/** DELETE /api/sc/quick-replies?id= */
export async function DELETE(req: Request) {
  const db = supabaseAdmin()
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const { error } = await db.from('sc_quick_replies').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
