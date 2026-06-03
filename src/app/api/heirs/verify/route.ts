import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

// POST /api/heirs/verify
// body: { prospect_phone_id, verified: boolean, agent?, lead_id? }
//
// Manual override for "this number is verified to be the heir's". Sets
// verified_source = 'manual' so a later auto-verify (from a reached
// disposition) never clobbers a deliberate human choice.
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { prospect_phone_id, verified, agent, lead_id } = body

    if (!prospect_phone_id || typeof verified !== 'boolean') {
      return NextResponse.json(
        { error: 'prospect_phone_id and verified (boolean) required' },
        { status: 400 },
      )
    }

    const now = new Date().toISOString()
    const { data, error } = await supabase
      .from('prospect_phones')
      .update({
        is_verified_contact: verified,
        verified_source: 'manual',
        verified_at: verified ? now : null,
        verified_by: verified ? (agent ?? null) : null,
      })
      .eq('id', prospect_phone_id)
      .select('id, prospect_id, phone, contact_name, relationship, prospects(lead_id)')
      .single<{
        id: string
        phone: string
        contact_name: string | null
        relationship: string | null
        prospects: { lead_id: string | null } | null
      }>()

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const resolvedLeadId = lead_id ?? data?.prospects?.lead_id ?? null
    if (resolvedLeadId) {
      await supabase.from('lead_activities').insert({
        lead_id: resolvedLeadId,
        activity_type: 'status_change',
        description: `${verified ? 'Verified' : 'Unverified'} ${data?.contact_name || 'heir'} number ${data?.phone || ''}`.trim(),
        agent: agent ?? 'Ernest',
        metadata: {
          source: 'heir_dialer',
          action: verified ? 'verify_contact' : 'unverify_contact',
          prospect_phone_id,
          heir_name: data?.contact_name,
          heir_relation: data?.relationship,
          phone: data?.phone,
        },
      })
    }

    return NextResponse.json({ success: true, verified })
  } catch (err) {
    console.error('[heirs/verify] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
