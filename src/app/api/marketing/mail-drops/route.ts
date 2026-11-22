import { NextRequest, NextResponse } from 'next/server'
import { requireAdminOrSecret } from '@/lib/api/admin-auth'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import { mailDropUrl, parseMailDropInput } from '@/lib/marketing/mail-drops'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' }

/** Direct mail drops with their response (G8). Any signed-in user can read; admins add drops. */
export async function GET() {
  const email = await getCurrentUserEmail()
  if (!email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: HEADERS })
  const { data, error } = await supabaseAdmin()
    .from('mail_drop_performance')
    .select('*')
    .order('drop_date', { ascending: false })
    .limit(200)
  if (error) return NextResponse.json({ error: 'Mail drops could not be read.' }, { status: 500, headers: HEADERS })
  // numeric columns arrive as strings; counts as numbers.
  const drops = (data ?? []).map((row: Record<string, unknown>) => ({
    ...row,
    cost: row.cost === null || row.cost === undefined ? null : Number(row.cost),
    revenue: Number(row.revenue ?? 0),
    url: mailDropUrl(row as { code: string; landing_path: string }),
  }))
  return NextResponse.json({ drops }, { headers: HEADERS })
}

export async function POST(req: NextRequest) {
  const unauthorized = await requireAdminOrSecret(req)
  if (unauthorized) return unauthorized
  const parsed = parseMailDropInput(await req.json().catch(() => null))
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400, headers: HEADERS })

  const db = supabaseAdmin()
  const createdBy = (await getCurrentUserEmail().catch(() => null)) || 'admin'
  const { data, error } = await db.from('mail_drops').insert({ ...parsed.value, created_by: createdBy }).select('id, code').single()
  if (error) {
    const duplicate = error.code === '23505'
    return NextResponse.json({ error: duplicate ? 'That code is already used by another drop.' : 'The drop could not be saved.' }, { status: duplicate ? 409 : 500, headers: HEADERS })
  }

  // Calls and texts to the drop's response number are credited to it (G7 channel table).
  if (parsed.value.response_number) {
    const { error: channelError } = await db.from('tracking_number_channels').upsert({
      number: parsed.value.response_number,
      channel: 'direct_mail',
      campaign: parsed.value.code,
      note: `Mail drop: ${parsed.value.name}`,
      updated_by: createdBy,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'number' })
    if (channelError) console.error('[mail-drops] response number channel failed:', channelError.message)
  }

  return NextResponse.json({ ok: true, id: data.id, code: data.code, url: mailDropUrl(parsed.value) }, { status: 201, headers: HEADERS })
}
