import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

// POST /api/heirs/sync
// body: { lead_id }
//
// Triggers a skip-trace run against the deceased owner linked to this lead and
// upserts the returned relatives into prospect_phones. Fronted behind the
// SKIPTRACE_SERVICE_URL env var so Jackson/Johnson/other counties can point at
// whatever deployment is live without another code change.
//
// Shape of expected service response:
//   { relatives: [{ name, relationship, phones: [{ number, type, is_connected }] }] }
export async function POST(req: Request) {
  try {
    const { lead_id } = await req.json()
    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
    }

    const { data: prospect, error: pErr } = await supabase
      .from('prospects')
      .select('id, owner_1, owner_1_first, owner_1_last, situs_street, situs_city, situs_state, situs_zip, county, is_deceased')
      .eq('lead_id', lead_id)
      .limit(1)
      .single()

    if (pErr || !prospect) {
      return NextResponse.json(
        { error: 'No prospect linked to this lead' },
        { status: 404 },
      )
    }

    if (!prospect.is_deceased) {
      return NextResponse.json(
        { error: 'Skip-trace heir flow is only for deceased owners' },
        { status: 400 },
      )
    }

    const serviceUrl = process.env.SKIPTRACE_SERVICE_URL
    if (!serviceUrl) {
      return NextResponse.json(
        {
          error: 'Skip-trace service not configured',
          hint: 'Set SKIPTRACE_SERVICE_URL in env to the FastAPI endpoint (see /Users/ernestdodson/skip-trace).',
        },
        { status: 503 },
      )
    }

    const upstream = await fetch(`${serviceUrl}/skip-trace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        first_name: prospect.owner_1_first,
        last_name: prospect.owner_1_last,
        address: prospect.situs_street,
        city: prospect.situs_city,
        state: prospect.situs_state,
        zip_code: prospect.situs_zip,
      }),
    })

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '')
      return NextResponse.json(
        { error: `Skip-trace service error (${upstream.status})`, detail: text.slice(0, 500) },
        { status: 502 },
      )
    }

    const result = await upstream.json()
    const relatives: Array<{
      name: string
      relationship?: string
      phones?: Array<{ number: string; type?: string; is_connected?: boolean }>
    }> = Array.isArray(result?.relatives) ? result.relatives : []

    // Upsert each (prospect_id, phone) — phone is the natural dedupe key since
    // prospect_phones has no unique constraint by default; we delete stale
    // heir-origin rows for this prospect first, then insert.
    await supabase
      .from('prospect_phones')
      .delete()
      .eq('prospect_id', prospect.id)
      .neq('relationship', 'owner')

    const rows = relatives.flatMap((r) =>
      (r.phones ?? []).map((ph) => ({
        prospect_id: prospect.id,
        phone: ph.number,
        phone_type: ph.type ?? null,
        phone_connected: ph.is_connected == null ? null : ph.is_connected ? 'connected' : 'disconnected',
        contact_name: r.name,
        relationship: (r.relationship ?? 'relative').toLowerCase(),
      })),
    )

    if (rows.length > 0) {
      const { error: insErr } = await supabase.from('prospect_phones').insert(rows)
      if (insErr) {
        return NextResponse.json({ error: insErr.message }, { status: 500 })
      }
    }

    await supabase.from('prospects').update({ is_skip_traced: true }).eq('id', prospect.id)

    return NextResponse.json({ success: true, relatives_synced: rows.length })
  } catch (err) {
    console.error('[heirs/sync] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
