import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import {
  assertDialerMutationControl,
  dialerMutationControlErrorResponse,
} from '@/lib/api/dialer-mutation-control'
import { supabase } from '@/lib/supabase-lazy'
import { isMissingColumnError } from '@/lib/schema-compat'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

// POST /api/heirs/verify
// body: { prospect_phone_id, verified: boolean, lead_id? }
//
// Manual override for "this number is verified to be the heir's". Sets
// verified_source = 'manual' so a later auto-verify (from a reached
// disposition) never clobbers a deliberate human choice.
export async function POST(req: Request) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const { prospect_phone_id, verified, lead_id, prospect_id, dialerSessionId } = body

    if (!prospect_phone_id || typeof verified !== 'boolean') {
      return NextResponse.json(
        { error: 'prospect_phone_id and verified (boolean) required' },
        { status: 400 },
      )
    }

    const { data: phoneRow, error: phoneError } = await supabase
      .from('prospect_phones')
      .select('id, prospect_id, phone, contact_name, relationship, prospects(lead_id)')
      .eq('id', prospect_phone_id)
      .single<{
        id: string
        prospect_id: string
        phone: string
        contact_name: string | null
        relationship: string | null
        prospects: { lead_id: string | null } | null
      }>()

    if (phoneError || !phoneRow) {
      return NextResponse.json({ error: 'Heir phone not found' }, { status: 404 })
    }

    const resolvedLeadId = phoneRow.prospects?.lead_id ?? null
    const resolvedProspectId = phoneRow.prospect_id
    if ((lead_id && lead_id !== resolvedLeadId) || (prospect_id && prospect_id !== resolvedProspectId)) {
      return NextResponse.json(
        { error: 'Selected heir phone does not belong to this record' },
        { status: 409 },
      )
    }
    if (!resolvedLeadId && !prospect_id) {
      return NextResponse.json({ error: 'Source prospect context is required for this heir phone' }, { status: 409 })
    }

    try {
      await assertDialerMutationControl({
        request: req,
        actor,
        sessionId: dialerSessionId,
        subject: { leadId: resolvedLeadId, prospectId: resolvedProspectId },
        protectMatchingOpenSession: true,
      })
    } catch (error) {
      const controlResponse = dialerMutationControlErrorResponse(error)
      if (controlResponse) return controlResponse
      throw error
    }

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('prospect_phones')
      .update({
        is_verified_contact: verified,
        verified_source: 'manual',
        verified_at: verified ? now : null,
        verified_by: verified ? actor.name : null,
      })
      .eq('id', prospect_phone_id)

    if (error) {
      // The verify columns come from 20260602_dialer_redesign.sql. Until it's
      // applied, surface a soft notice instead of a hard 500.
      if (isMissingColumnError(error)) {
        return NextResponse.json({
          success: false,
          pendingMigration: true,
          message: 'Contact verification is unavailable until migration 20260602_dialer_redesign.sql is applied.',
        })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const { error: activityError } = await supabase.from('lead_activities').insert({
      lead_id: resolvedLeadId,
      activity_type: 'status_change',
      description: `${verified ? 'Verified' : 'Unverified'} ${phoneRow.contact_name || 'heir'} number ${phoneRow.phone || ''}`.trim(),
      agent: actor.name,
      metadata: {
        source: 'heir_dialer',
        prospect_id: resolvedProspectId,
        thread_key: resolvedLeadId
          ? `lead:${resolvedLeadId}`
          : `phone:${normalizePhoneToE164(phoneRow.phone) ?? phoneRow.phone}`,
        action: verified ? 'verify_contact' : 'unverify_contact',
        prospect_phone_id,
        heir_name: phoneRow.contact_name,
        heir_relation: phoneRow.relationship,
        phone: phoneRow.phone,
      },
    })

    return NextResponse.json({
      success: true,
      verified,
      ...(activityError
        ? { warning: 'Verification saved, but the activity timeline could not be updated.' }
        : {}),
    })
  } catch (err) {
    console.error('[heirs/verify] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
