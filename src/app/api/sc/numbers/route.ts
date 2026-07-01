import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { TWILIO_NUMBERS } from '@/lib/twilio-numbers'
import { blockRate, type SendingNumber } from '@/lib/smartercontact/numbers'

/** GET /api/sc/numbers — list the sending-number pool with computed block rate. */
export async function GET() {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from('sc_sending_numbers')
    .select('*')
    .order('created_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const numbers = (data as SendingNumber[]).map((n) => ({
    ...n,
    block_rate: blockRate(n),
  }))
  return NextResponse.json({ numbers })
}

/**
 * POST /api/sc/numbers
 *   { action: 'seed' }                       → import from TWILIO_NUMBERS
 *   { phone, label, type }                   → add a single number
 */
export async function POST(req: Request) {
  const db = supabaseAdmin()
  const body = await req.json().catch(() => ({}))

  if (body.action === 'seed') {
    const rows = TWILIO_NUMBERS.map((n) => ({
      phone: n.value,
      label: n.label,
      type: 'local' as const,
      status: 'active' as const,
      provider: 'twilio',
    }))
    // Upsert on phone so re-seeding is idempotent and never clobbers stats.
    const { error } = await db
      .from('sc_sending_numbers')
      .upsert(rows, { onConflict: 'phone', ignoreDuplicates: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true, seeded: rows.length })
  }

  if (body.phone) {
    const { data, error } = await db
      .from('sc_sending_numbers')
      .upsert(
        {
          phone: body.phone,
          label: body.label ?? null,
          type: body.type === 'toll_free' ? 'toll_free' : 'local',
          status: 'active',
          provider: 'twilio',
        },
        { onConflict: 'phone' },
      )
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ number: data })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/** PATCH /api/sc/numbers — update a number's status (active|paused|warming|released). */
export async function PATCH(req: Request) {
  const db = supabaseAdmin()
  const { id, status, daily_cap, label } = await req.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  const patch: Record<string, unknown> = {}
  if (status) patch.status = status
  if (typeof daily_cap === 'number') patch.daily_cap = daily_cap
  if (label !== undefined) patch.label = label
  const { data, error } = await db
    .from('sc_sending_numbers')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ number: data })
}
