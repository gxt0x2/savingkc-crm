import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
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
    const actor = await resolveAuthenticatedActor()
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

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
      addresses?: Array<string | { street?: string; city?: string; state?: string; zip?: string }>
    }> = Array.isArray(result?.relatives) ? result.relatives : []

    function firstAddress(addrs: typeof relatives[number]['addresses']): string | null {
      if (!addrs || addrs.length === 0) return null
      const a = addrs[0]
      if (typeof a === 'string') return a
      return [a.street, a.city, a.state, a.zip].filter(Boolean).join(', ') || null
    }

    const rows = relatives.flatMap((r) => {
      const address = firstAddress(r.addresses)
      return (r.phones ?? []).map((ph) => ({
        prospect_id: prospect.id,
        phone: ph.number,
        phone_type: ph.type ?? null,
        phone_connected: ph.is_connected == null ? null : ph.is_connected ? 'connected' : 'disconnected',
        contact_name: r.name,
        relationship: (r.relationship ?? 'relative').toLowerCase(),
        contact_address: address,
      }))
    })

    if (rows.length === 0) {
      return NextResponse.json(
        { error: 'Skip trace returned no usable phone records; existing heirs were preserved.' },
        { status: 422 },
      )
    }

    // The current schema has no transactional replacement RPC. Preserve old
    // data when the upstream result is empty, and only remove stale heir rows
    // after a complete replacement payload has been validated.
    const { error: deleteError } = await supabase
      .from('prospect_phones')
      .delete()
      .eq('prospect_id', prospect.id)
      .neq('relationship', 'owner')

    if (deleteError) {
      return NextResponse.json({ error: deleteError.message }, { status: 500 })
    }

    const { error: insErr } = await supabase.from('prospect_phones').insert(rows)
    if (insErr) {
      return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    const { error: prospectError } = await supabase
      .from('prospects')
      .update({ is_skip_traced: true })
      .eq('id', prospect.id)

    const { error: activityError } = await supabase.from('lead_activities').insert({
      lead_id,
      activity_type: 'status_change',
      description: `Heir skip trace synced ${rows.length} phone record${rows.length === 1 ? '' : 's'}`,
      agent: actor.name,
      metadata: {
        source: 'heir_dialer',
        action: 'sync_heirs',
        prospect_id: prospect.id,
        phone_records_synced: rows.length,
      },
    })

    return NextResponse.json({
      success: true,
      relatives_synced: rows.length,
      ...(prospectError || activityError
        ? { warning: 'Heirs were synced, but some CRM tracking details could not be updated.' }
        : {}),
    })
  } catch (err) {
    console.error('[heirs/sync] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
