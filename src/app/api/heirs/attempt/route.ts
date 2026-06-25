import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'
import {
  normalizeDisposition,
  isReachedDisposition,
  isDeadDisposition,
  isValidDeadReason,
} from '@/lib/dialer-dispositions'
import { isMissingColumnError } from '@/lib/schema-compat'

// POST /api/heirs/attempt
// body: {
//   prospect_phone_id, disposition, notes?, lead_id?, agent?, duration?,
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
    const body = await req.json()
    const {
      prospect_phone_id,
      disposition: rawDisposition,
      notes,
      lead_id,
      agent,
      duration,
      mark_as_lead,
      verified,
      dead_reason,
    } = body

    if (!prospect_phone_id || !rawDisposition) {
      return NextResponse.json(
        { error: 'prospect_phone_id and disposition required' },
        { status: 400 },
      )
    }

    const disposition = normalizeDisposition(rawDisposition) ?? String(rawDisposition)
    const reached = isReachedDisposition(disposition)
    const isDead = isDeadDisposition(disposition)
    const deadReason = isValidDeadReason(dead_reason)
      ? dead_reason
      : (isDead && dead_reason ? String(dead_reason) : null)

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
        .eq('id', prospect_phone_id)
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
        verified_by: verified ? (agent ?? null) : null,
      }
    } else if (reached && phoneRow.verified_source !== 'manual') {
      verificationPatch = {
        is_verified_contact: true,
        verified_source: 'auto',
        verified_at: now,
        verified_by: agent ?? null,
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
      last_attempt_by: agent ?? null,
    }
    let upErr = (await supabase
      .from('prospect_phones')
      .update({ ...baseAttemptPatch, ...verificationPatch })
      .eq('id', prospect_phone_id)).error
    // If the verify columns aren't migrated yet, still record the attempt.
    if (upErr && isMissingColumnError(upErr) && Object.keys(verificationPatch).length > 0) {
      upErr = (await supabase
        .from('prospect_phones')
        .update(baseAttemptPatch)
        .eq('id', prospect_phone_id)).error
    }

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
          prospect_owner_name: phoneRow.prospects?.owner_1,
          mark_as_lead: Boolean(mark_as_lead),
          verified: verificationResult,
          dead_reason: deadReason,
        },
      })

      // Dead lead — roll the whole property to station 'dead' with the why.
      if (isDead) {
        const baseDeadPatch = { station: 'dead', updated_at: now }
        let deadErr = (await supabase
          .from('leads')
          .update({ ...baseDeadPatch, dead_reason: deadReason, dead_at: now, dead_by: agent ?? null })
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

        await supabase.from('lead_activities').insert({
          lead_id: resolvedLeadId,
          activity_type: 'status_change',
          description: `Marked lead dead${deadReason ? ` — ${deadReason.replace(/_/g, ' ')}` : ''}`,
          agent: agent ?? 'Ernest',
          metadata: {
            source: 'heir_dialer',
            action: 'mark_dead',
            station: 'dead',
            dead_reason: deadReason,
            notes: notes ?? null,
          },
        })
      }

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
            prospect_owner_name: phoneRow.prospects?.owner_1,
            phone: phoneRow.phone,
            action: 'mark_as_lead',
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
