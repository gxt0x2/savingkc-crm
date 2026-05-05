import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

// POST /api/heirs/attempt
// body: { prospect_phone_id, disposition, notes?, lead_id?, agent?, duration? }
//
// Marks a single heir phone as attempted (denormalized fields on prospect_phones)
// AND appends an immutable row to lead_activities for the call timeline.
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const { prospect_phone_id, disposition, notes, lead_id, agent, duration, mark_as_lead } = body

    if (!prospect_phone_id || !disposition) {
      return NextResponse.json(
        { error: 'prospect_phone_id and disposition required' },
        { status: 400 },
      )
    }

    // Pull phone + prospect context so the activity row has readable metadata.
    type PhoneWithProspect = {
      id: string
      phone: string
      contact_name: string | null
      relationship: string | null
      prospect_id: string
      prospects: { lead_id: string | null; owner_1: string | null } | null
    }

    const { data: phoneRow, error: phErr } = await supabase
      .from('prospect_phones')
      .select('id, phone, contact_name, relationship, prospect_id, prospects(lead_id, owner_1)')
      .eq('id', prospect_phone_id)
      .single<PhoneWithProspect>()

    if (phErr || !phoneRow) {
      return NextResponse.json(
        { error: phErr?.message || 'phone not found' },
        { status: 404 },
      )
    }

    const now = new Date().toISOString()

    // 1. Denormalized update — drives the ✓ in HeirsSection.
    const { error: upErr } = await supabase
      .from('prospect_phones')
      .update({
        attempted: true,
        last_disposition: disposition,
        last_attempt_at: now,
        last_attempt_by: agent ?? null,
      })
      .eq('id', prospect_phone_id)

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    // 2. Immutable activity row — property timeline.
    const resolvedLeadId = lead_id ?? phoneRow.prospects?.lead_id ?? null
    if (resolvedLeadId) {
      await supabase.from('lead_activities').insert({
        lead_id: resolvedLeadId,
        activity_type: 'call',
        description: `Call to ${phoneRow.contact_name || 'heir'} (${phoneRow.relationship || 'relative'}) — ${disposition.replace(/_/g, ' ')}`,
        agent: agent ?? 'Ernest',
        metadata: {
          direction: 'outbound',
          to: phoneRow.phone,
          disposition,
          duration: duration ?? null,
          notes: notes ?? null,
          source: 'heir_dialer',
          prospect_phone_id: phoneRow.id,
          heir_name: phoneRow.contact_name,
          heir_relation: phoneRow.relationship,
          mark_as_lead: Boolean(mark_as_lead),
        },
      })

      if (mark_as_lead) {
        const contactName = phoneRow.contact_name || phoneRow.prospects?.owner_1 || 'Unknown seller'
        const { error: leadErr } = await supabase
          .from('leads')
          .update({
            full_name: contactName,
            phone: phoneRow.phone,
            updated_at: now,
          })
          .eq('id', resolvedLeadId)

        if (leadErr) {
          return NextResponse.json({ error: leadErr.message }, { status: 500 })
        }

        await supabase.from('lead_activities').insert({
          lead_id: resolvedLeadId,
          activity_type: 'status_change',
          description: `Marked ${contactName} (${phoneRow.relationship || 'relative'}) as primary lead contact`,
          agent: agent ?? 'Ernest',
          metadata: {
            source: 'heir_dialer',
            prospect_phone_id: phoneRow.id,
            heir_name: phoneRow.contact_name,
            heir_relation: phoneRow.relationship,
            phone: phoneRow.phone,
            action: 'mark_as_lead',
          },
        })
      }
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[heirs/attempt] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
