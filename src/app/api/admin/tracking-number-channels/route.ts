import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { parseNumberChannelEdit } from '@/lib/attribution/number-channels'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

/** Channel per Twilio number for inbound call and text attribution (G7). Admin only. */
export async function GET(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized
  const { data, error } = await supabaseAdmin()
    .from('tracking_number_channels')
    .select('number,channel,campaign,note,updated_by,updated_at')
    .order('number')
  if (error) return NextResponse.json({ error: 'Could not load number channels' }, { status: 500, headers: HEADERS })
  return NextResponse.json({ rows: data ?? [] }, { headers: HEADERS })
}

export async function PUT(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized
  const edit = parseNumberChannelEdit(await req.json().catch(() => null))
  if (!edit) return NextResponse.json({ error: 'Pick a valid number and channel' }, { status: 400, headers: HEADERS })

  const db = supabaseAdmin()
  if (edit.channel === null) {
    const { error } = await db.from('tracking_number_channels').delete().eq('number', edit.number)
    if (error) return NextResponse.json({ error: 'Could not clear the channel' }, { status: 500, headers: HEADERS })
    return NextResponse.json({ ok: true, row: null }, { headers: HEADERS })
  }
  const { data, error } = await db
    .from('tracking_number_channels')
    .upsert({
      number: edit.number,
      channel: edit.channel,
      campaign: edit.campaign,
      note: edit.note,
      updated_by: (await getCurrentUserEmail().catch(() => null)) || 'admin',
      updated_at: new Date().toISOString(),
    }, { onConflict: 'number' })
    .select('number,channel,campaign,note,updated_by,updated_at')
    .single()
  if (error) return NextResponse.json({ error: 'Could not save the channel' }, { status: 500, headers: HEADERS })
  return NextResponse.json({ ok: true, row: data }, { headers: HEADERS })
}
