import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

/**
 * GET /api/sc/conversations?filter=all&search=&limit=
 * Returns inbox threads for the SmarterContact Messenger, matching its filters:
 *   all | unread | missed_calls | unreplied | awaiting_reply | opted_out | deleted
 */
export async function GET(req: Request) {
  const db = supabaseAdmin()
  const url = new URL(req.url)
  const filter = url.searchParams.get('filter') || 'all'
  const search = (url.searchParams.get('search') || '').trim()
  const limit = Math.min(Number(url.searchParams.get('limit')) || 100, 500)

  let q = db
    .from('sc_conversations')
    .select('*')
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  switch (filter) {
    case 'unread':
      q = q.eq('status', 'open').eq('is_read', false)
      break
    case 'missed_calls':
      q = q.eq('status', 'open').eq('missed_call', true)
      break
    case 'unreplied':
      // Last message is inbound → needs our reply.
      q = q.eq('status', 'open').eq('last_direction', 'inbound')
      break
    case 'awaiting_reply':
      // We sent, they haven't replied yet.
      q = q.eq('status', 'open').eq('awaiting_reply', true).eq('last_direction', 'outbound')
      break
    case 'opted_out':
      q = q.eq('opted_out', true)
      break
    case 'deleted':
      q = q.eq('status', 'deleted')
      break
    case 'all':
    default:
      q = q.eq('status', 'open')
      break
  }

  if (search) {
    q = q.or(`contact_phone.ilike.%${search}%,last_body.ilike.%${search}%`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Attach contact display info where available.
  const contactIds = [...new Set((data || []).map((c) => c.contact_id).filter(Boolean))]
  const contactMap: Record<string, { first_name: string | null; last_name: string | null }> = {}
  if (contactIds.length) {
    const { data: contacts } = await db
      .from('sc_contacts')
      .select('id, first_name, last_name')
      .in('id', contactIds as string[])
    for (const c of contacts || []) contactMap[c.id] = c
  }

  const threads = (data || []).map((c) => ({
    ...c,
    contact_name: c.contact_id
      ? [contactMap[c.contact_id]?.first_name, contactMap[c.contact_id]?.last_name]
          .filter(Boolean)
          .join(' ') || null
      : null,
  }))

  // Unread total for the badge.
  const { count: unreadTotal } = await db
    .from('sc_conversations')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .eq('is_read', false)

  return NextResponse.json({ threads, unreadTotal: unreadTotal || 0 })
}
