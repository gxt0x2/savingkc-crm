import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { scSendSms, markConversationRead } from '@/lib/smartercontact/messaging'

/** GET /api/sc/conversations/:id — thread + messages. */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = supabaseAdmin()
  const { data: convo, error } = await db
    .from('sc_conversations')
    .select('*')
    .eq('id', id)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  const { data: messages } = await db
    .from('sc_messages')
    .select('*')
    .eq('conversation_id', id)
    .order('created_at', { ascending: true })
  return NextResponse.json({ conversation: convo, messages: messages || [] })
}

/**
 * POST /api/sc/conversations/:id
 *   { action: 'send', body }   → reply to this thread (sticky number)
 *   { action: 'read' }         → mark read
 *   { action: 'delete' }       → soft-delete thread
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))

  const { data: convo } = await db
    .from('sc_conversations')
    .select('id, contact_phone, contact_id')
    .eq('id', id)
    .single()
  if (!convo) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.action === 'read') {
    await markConversationRead(id)
    return NextResponse.json({ success: true })
  }

  if (body.action === 'delete') {
    await db.from('sc_conversations').update({ status: 'deleted' }).eq('id', id)
    return NextResponse.json({ success: true })
  }

  if (body.action === 'send') {
    if (!body.body?.trim()) {
      return NextResponse.json({ error: 'Empty message' }, { status: 400 })
    }
    const res = await scSendSms({
      toPhone: convo.contact_phone,
      body: body.body.trim(),
      contactId: convo.contact_id,
      sticky: true,
    })
    if (!res.success) {
      return NextResponse.json(
        { error: res.skipped === 'opted_out' ? 'Contact has opted out' : res.error || 'Send failed' },
        { status: 400 },
      )
    }
    return NextResponse.json({ success: true, sid: res.sid, from: res.from })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
