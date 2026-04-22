export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// GET /api/notifications — list recent notifications
export async function GET(req: NextRequest) {
  const db = supabaseAdmin()
  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unread') === '1'
  const limit = Math.min(Number(url.searchParams.get('limit') || 20), 50)

  let query = db
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) {
    query = query.eq('is_read', false)
  }

  const { data, error } = await query
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Also get unread count
  const { count } = await db
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('is_read', false)

  return NextResponse.json({ notifications: data || [], unread_count: count || 0 })
}

// PATCH /api/notifications — mark notifications as read
export async function PATCH(req: NextRequest) {
  const db = supabaseAdmin()
  const body = await req.json()

  if (body.mark_all_read) {
    await db.from('notifications').update({ is_read: true }).eq('is_read', false)
    return NextResponse.json({ ok: true })
  }

  if (body.id) {
    await db.from('notifications').update({ is_read: true }).eq('id', body.id)
    return NextResponse.json({ ok: true })
  }

  return NextResponse.json({ error: 'Provide id or mark_all_read' }, { status: 400 })
}
