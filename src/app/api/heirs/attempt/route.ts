import { NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { buildHeirAttemptCommand } from '@/lib/server/heir-attempt-command'
import { findHeirAttemptEvidence, insertHeirAttemptEvidenceOnce } from '@/lib/server/heir-attempt-evidence'
import { recordHeirAppointment } from '@/lib/server/heir-appointment-command'
import { supabase } from '@/lib/supabase-lazy'
import { isMissingColumnError } from '@/lib/schema-compat'

// POST /api/heirs/attempt
// body: {
//   prospect_phone_id, disposition, notes?, lead_id?, duration?,
//   mark_as_lead?, verified?, dead_reason?
// }
//
// Marks a single heir phone as attempted (denormalized fields on prospect_phones)
// AND appends an immutable row to lead_activities for the call timeline.
//
// Two redesign behaviours live here:
//   • Auto-verify — when the disposition means the agent actually reached the
//     person, the number is flagged is_verified_contact (source 'auto'), unless
//     a human previously set it manually (source 'manual' is never clobbered).
//     `verified` (boolean) is an explicit manual override from the modal.
//   • Dead lead — a 'dead' disposition rolls the WHOLE lead to station 'dead'
//     and records dead_reason / dead_at / dead_by ("mark as dead + why").
export async function POST(req: Request) {
  try {
    const actor = await resolveAuthenticatedActor()
    if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const parsed = buildHeirAttemptCommand(await req.json())
    if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
    const {
      prospectPhoneId,
      disposition,
      notes,
      requestedLeadId,
      durationSeconds,
      markAsLead,
      verified,
      deadReason,
      appointmentAt,
      clientAttemptId,
      reached,
      dead: isDead,
    } = parsed.command
    const actorName = actor.name

    // Pull phone + prospect context so the activity row has readable metadata,
    // plus the current verification source so a manual choice is never undone.
    type PhoneWithProspect = {
      id: string
      phone: string
      contact_name: string | null
      relationship: string | null
      prospect_id: string
      verified_source: string | null
      prospects: { lead_id: string | null; owner_1: string | null } | null
    }

    const selectPhone = (cols: string) =>
      supabase
        .from('prospect_phones')
        .select(cols)
        .eq('id', prospectPhoneId)
        .single<PhoneWithProspect>()

    // verified_source comes from 20260602_dialer_redesign.sql; tolerate its
    // absence so logging a call still works before that migration is applied.
    let phoneRes = await selectPhone('id, phone, contact_name, relationship, prospect_id, verified_source, prospects(lead_id, owner_1)')
    if (phoneRes.error && isMissingColumnError(phoneRes.error)) {
      phoneRes = await selectPhone('id, phone, contact_name, relationship, prospect_id, prospects(lead_id, owner_1)')
    }
    const { data: phoneRow, error: phErr } = phoneRes

    if (phErr || !phoneRow) {
      return NextResponse.json(
        { error: phErr?.message || 'phone not found' },
        { status: 404 },
      )
    }

    const resolvedLeadId = phoneRow.prospects?.lead_id ?? null
    if (!resolvedLeadId) {
      return NextResponse.json({ error: 'Heir phone has no linked contact record' }, { status: 409 })
    }
    if (requestedLeadId && requestedLeadId !== resolvedLeadId) {
      return NextResponse.json({ error: 'Heir phone does not belong to that contact' }, { status: 409 })
    }
    const existingCall = resolvedLeadId ? await findHeirAttemptEvidence({
      leadId: resolvedLeadId,
      activityType: 'call',
      clientAttemptId,
    }) : null
    if (existingCall && (
      existingCall.metadata?.disposition !== disposition
      || existingCall.metadata?.prospect_phone_id !== phoneRow.id
      || (existingCall.metadata?.scheduled_at ?? null) !== appointmentAt
      || Boolean(existingCall.metadata?.mark_as_lead) !== markAsLead
      || (existingCall.metadata?.dead_reason ?? null) !== deadReason
    )) {
      return NextResponse.json(
        { error: 'This dialer attempt was already saved with a different outcome' },
        { status: 409 },
      )
    }

    const now = new Date().toISOString()

    // Resolve the verification outcome for this phone.
    // - explicit boolean `verified` → manual override (always wins)
    // - otherwise auto-verify on a "reached" disposition, unless a human
    //   previously set it ('manual').
    let verificationPatch: Record<string, unknown> = {}
    if (typeof verified === 'boolean') {
      verificationPatch = {
        is_verified_contact: verified,
        verified_source: 'manual',
        verified_at: verified ? now : null,
        verified_by: verified ? actorName : null,
      }
    } else if (reached && phoneRow.verified_source !== 'manual') {
      verificationPatch = {
        is_verified_contact: true,
        verified_source: 'auto',
        verified_at: now,
        verified_by: actorName,
      }
    }

    const verificationResult = 'is_verified_contact' in verificationPatch
      ? Boolean(verificationPatch.is_verified_contact)
      : reached

    // 1. Denormalized update — drives status + ✓ in HeirsSection.
    const baseAttemptPatch = {
      attempted: true,
      last_disposition: disposition,
      last_attempt_at: now,
      last_attempt_by: actorName,
    }
    let upErr = (await supabase
      .from('prospect_phones')
      .update({ ...baseAttemptPatch, ...verificationPatch })
      .eq('id', prospectPhoneId)).error
    // If the verify columns aren't migrated yet, still record the attempt.
    if (upErr && isMissingColumnError(upErr) && Object.keys(verificationPatch).length > 0) {
      upErr = (await supabase
        .from('prospect_phones')
        .update(baseAttemptPatch)
        .eq('id', prospectPhoneId)).error
    }

    if (upErr) {
      return NextResponse.json({ error: upErr.message }, { status: 500 })
    }

    // 2. Canonical activity evidence — property timeline.
    {
      const appointment = appointmentAt ? await recordHeirAppointment({
        leadId: resolvedLeadId,
        actorName,
        appointmentAt,
        notes,
        clientAttemptId,
        prospectPhoneId: phoneRow.id,
        heirName: phoneRow.contact_name,
      }) : null
      await insertHeirAttemptEvidenceOnce({
        leadId: resolvedLeadId,
        activityType: 'call',
        clientAttemptId,
        payload: {
          lead_id: resolvedLeadId,
          activity_type: 'call',
          description: `Call to ${phoneRow.contact_name || 'heir'} (${phoneRow.relationship || 'relative'}) — ${disposition.replace(/_/g, ' ')}`,
          agent: actorName,
          metadata: {
            direction: 'outbound',
            to: phoneRow.phone,
            disposition,
            duration: durationSeconds,
            notes,
            source: 'heir_dialer',
            client_attempt_id: clientAttemptId,
            prospect_phone_id: phoneRow.id,
            heir_name: phoneRow.contact_name,
            heir_relation: phoneRow.relationship,
            prospect_owner_name: phoneRow.prospects?.owner_1,
            mark_as_lead: markAsLead,
            verified: verificationResult,
            dead_reason: deadReason,
            appointment_id: appointment?.appointmentId ?? null,
            scheduled_at: appointmentAt,
          },
        },
      })

      // Dead lead — roll the whole property to station 'dead' with the why.
      if (isDead) {
        const baseDeadPatch = { station: 'dead', updated_at: now }
        let deadErr = (await supabase
          .from('leads')
          .update({ ...baseDeadPatch, dead_reason: deadReason, dead_at: now, dead_by: actorName })
          .eq('id', resolvedLeadId)).error
        // dead_reason/at/by come from 20260602; still move the lead to 'dead'.
        if (deadErr && isMissingColumnError(deadErr)) {
          deadErr = (await supabase
            .from('leads')
            .update(baseDeadPatch)
            .eq('id', resolvedLeadId)).error
        }

        if (deadErr) {
          return NextResponse.json({ error: deadErr.message }, { status: 500 })
        }

        await insertHeirAttemptEvidenceOnce({
          leadId: resolvedLeadId,
          activityType: 'status_change',
          clientAttemptId,
          action: 'mark_dead',
          payload: {
            lead_id: resolvedLeadId,
            activity_type: 'status_change',
            description: `Marked lead dead${deadReason ? ` — ${deadReason.replace(/_/g, ' ')}` : ''}`,
            agent: actorName,
            metadata: {
              source: 'heir_dialer',
              client_attempt_id: clientAttemptId,
              action: 'mark_dead',
              station: 'dead',
              dead_reason: deadReason,
              notes: notes ?? null,
            },
          },
        })
      }

      if (markAsLead) {
        const contactName = phoneRow.contact_name || phoneRow.prospects?.owner_1 || 'Unknown seller'
        const { error: leadErr } = await supabase
          .from('leads')
          .update({
            full_name: contactName,
            phone: phoneRow.phone,
            classification: 'lead',
            station: 'contacted',
            updated_at: now,
          })
          .eq('id', resolvedLeadId)

        if (leadErr) {
          return NextResponse.json({ error: leadErr.message }, { status: 500 })
        }

        await insertHeirAttemptEvidenceOnce({
          leadId: resolvedLeadId,
          activityType: 'status_change',
          clientAttemptId,
          action: 'mark_as_lead',
          payload: {
            lead_id: resolvedLeadId,
            activity_type: 'status_change',
            description: `Marked ${contactName} (${phoneRow.relationship || 'relative'}) as primary lead contact`,
            agent: actorName,
            metadata: {
              source: 'heir_dialer',
              client_attempt_id: clientAttemptId,
              prospect_phone_id: phoneRow.id,
              heir_name: phoneRow.contact_name,
              heir_relation: phoneRow.relationship,
              prospect_owner_name: phoneRow.prospects?.owner_1,
              phone: phoneRow.phone,
              action: 'mark_as_lead',
              classification: 'lead',
              station: 'contacted',
            },
          },
        })
      }
    }

    return NextResponse.json({
      success: true,
      disposition,
      verified: verificationResult,
      dead: isDead,
    })
  } catch (err) {
    console.error('[heirs/attempt] error', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
