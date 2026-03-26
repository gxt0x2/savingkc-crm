import { NextResponse } from 'next/server'

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

  const res = await fetch(
    `${supabaseUrl}/rest/v1/leads?select=station,priority,created_at`,
    {
      headers: {
        apikey: serviceKey!,
        Authorization: `Bearer ${serviceKey}`,
      },
    }
  )

  const rows: Array<{ station: string; priority: string; created_at: string }> =
    await res.json()

  const today = new Date().toISOString().slice(0, 10)
  let total_leads = 0
  let hot_leads = 0
  let active_leads = 0
  let today_calls = 0
  const by_stage: Record<string, number> = {}

  for (const row of rows) {
    total_leads++
    if (row.priority === 'hot') hot_leads++
    if (row.station && row.station !== 'intake' && row.station !== 'dead') active_leads++
    if (row.created_at?.startsWith(today)) today_calls++
    const s = row.station || 'unknown'
    by_stage[s] = (by_stage[s] || 0) + 1
  }

  return NextResponse.json({ total_leads, hot_leads, active_leads, today_calls, by_stage })
}
