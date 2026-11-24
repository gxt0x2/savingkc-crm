import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { formatPhone } from '@/lib/format'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { isMissingColumnError } from '@/lib/schema-compat'
import { supabase } from '@/lib/supabase-lazy'

// POST /api/heirs/voice-hold
// body: { prospect_phone_id, hold: boolean, reason?: string, lead_id?, prospect_id? }
//
// Sets or clears a per-phone VOICE hold. Never writes sms_opt_outs: SMS
// consent and voice hold are separate controls.
export async function POST(req: Request) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const body = await req.json().catch(() => null) as Record<string, unknown> | null
    const prospectPhoneId = typeof body?.prospect_phone_id === 'string' ? body.prospect_phone_id.trim() : ''
    const hold = body?.hold
    if (!prospectPhoneId || typeof hold !== 'boolean') {
      return NextResponse.json({ error: 'prospect_phone_id and hold (boolean) required' }, { status: 400 })
    }
    const reason = typeof body?.reason === 'string' && body.reason.trim() ? body.reason.trim().slice(0, 200) : null
    const leadId = typeof body?.lead_id === 'string' ? body.lead_id : null
    const prospectId = typeof body?.prospect_id === 'string' ? body.prospect_id : null

    const { data: phoneRow, error: phoneError } = await supabase
      .from('prospect_phones')
      .select('id, prospect_id, phone, contact_name, prospects(lead_id)')
      .eq('id', prospectPhoneId)
      .single<{ id: string; prospect_id: string; phone: string; contact_name: string | null; prospects: { lead_id: string | null } | null }>()
    if (phoneError || !phoneRow) return NextResponse.json({ error: 'Phone not found' }, { status: 404 })

    const resolvedLeadId = phoneRow.prospects?.lead_id ?? null
    if ((leadId && leadId !== resolvedLeadId) || (prospectId && prospectId !== phoneRow.prospect_id)) {
      return NextResponse.json({ error: 'Selected phone does not belong to this record' }, { status: 409 })
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('prospect_phones')
      .update(hold
        ? { voice_hold: true, voice_hold_reason: reason, voice_hold_at: now, voice_hold_by: actor.name }
        : { voice_hold: false, voice_hold_reason: null, voice_hold_at: null, voice_hold_by: null })
      .eq('id', prospectPhoneId)
    if (error) {
      if (isMissingColumnError(error)) {
        return NextResponse.json({
          success: false,
          pendingMigration: true,
          error: 'Voice hold is unavailable until migration 20261130130000_prospect_phone_voice_hold.sql is applied.',
        }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { error: activityError } = await supabase.from('lead_activities').insert({
      lead_id: resolvedLeadId,
      activity_type: 'status_change',
      description: `${hold ? 'Voice hold set on' : 'Voice hold cleared on'} ${phoneRow.contact_name || 'contact'} number ${formatPhone(phoneRow.phone) || phoneRow.phone}`,
      agent: actor.name,
      metadata: {
        source: 'voice_hold',
        action: hold ? 'voice_hold_set' : 'voice_hold_cleared',
        prospect_id: phoneRow.prospect_id,
        prospect_phone_id: phoneRow.id,
        phone: phoneRow.phone,
        reason,
        thread_key: resolvedLeadId ? `lead:${resolvedLeadId}` : `phone:${normalizePhoneToE164(phoneRow.phone) ?? phoneRow.phone}`,
      },
    })

    return NextResponse.json({
      success: true,
      hold,
      ...(activityError ? { warning: 'Voice hold saved, but the activity timeline could not be updated.' } : {}),
    })
  } catch (err) {
    console.error('[heirs/voice-hold] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
