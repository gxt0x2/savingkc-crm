import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

/** GET /api/sc/suppression?search=&limit= — list suppressed (opted-out) numbers. */
export async function GET(req: Request) {
  const db = supabaseAdmin()
  const url = new URL(req.url)
  const search = (url.searchParams.get('search') || '').trim()
  const limit = Math.min(Number(url.searchParams.get('limit')) || 200, 1000)

  let q = db
    .from('sms_opt_outs')
    .select('*')
    .eq('is_opted_out', true)
    .order('opted_out_at', { ascending: false, nullsFirst: false })
    .limit(limit)

  if (search) {
    const s = search.replace(/,/g, '')
    q = q.ilike('phone', `%${s}%`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ suppressed: data || [] })
}

/** POST /api/sc/suppression — manually suppress { phone, reason }. */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))
  const phone = normalizePhoneToE164(body.phone)
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })

  const { data, error } = await db
    .from('sms_opt_outs')
    .upsert(
      {
        phone,
        is_opted_out: true,
        opted_out_at: new Date().toISOString(),
        reason: body.reason || 'manual',
      },
      { onConflict: 'phone' },
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ suppressed: data })
}

/** DELETE /api/sc/suppression?phone= — un-suppress (opt back in). */
export async function DELETE(req: Request) {
  const db = supabaseAdmin()
  const raw = new URL(req.url).searchParams.get('phone')
  const phone = normalizePhoneToE164(raw)
  if (!phone) return NextResponse.json({ error: 'Invalid phone number' }, { status: 400 })
  const { error } = await db
    .from('sms_opt_outs')
    .update({ is_opted_out: false, opted_in_at: new Date().toISOString() })
    .eq('phone', phone)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
