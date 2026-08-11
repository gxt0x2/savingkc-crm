export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { requireUserOrSecret } from '@/lib/api/admin-auth'
import { getCurrentUserEmail } from '@/lib/auth/admin'
import {
  nextStageAfterOffer,
  offerActivityDescription,
  parseLeadOfferInput,
} from '@/lib/lead-offer'
import { ensureManifestExists, updateManifestAndCascade } from '@/lib/manifest-sync'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const unauthorized = await requireUserOrSecret(request)
  if (unauthorized) return unauthorized

  const { id } = await params
  if (!id) return NextResponse.json({ error: 'Lead id is required.' }, { status: 400 })

  const parsed = parseLeadOfferInput(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const db = supabaseAdmin()
  const { data: lead, error: leadError } = await db
    .from('leads')
    .select('id, full_name, station, classification, assigned_agent, offer_amount')
    .eq('id', id)
    .maybeSingle()

  if (leadError) return NextResponse.json({ error: leadError.message }, { status: 500 })
  if (!lead) return NextResponse.json({ error: 'Lead not found.' }, { status: 404 })

  const nextStation = nextStageAfterOffer(lead.station)
  if (!nextStation || lead.classification === 'dead') {
    return NextResponse.json({ error: 'Reopen this contact before recording an offer.' }, { status: 409 })
  }

  const userEmail = await getCurrentUserEmail()
  let actor = lead.assigned_agent?.trim() || 'Authenticated user'
  if (userEmail) {
    const { data: profile } = await db
      .from('agent_profiles')
      .select('full_name')
      .eq('email', userEmail)
      .maybeSingle()
    actor = profile?.full_name?.trim() || userEmail.split('@')[0].replace(/[._-]+/g, ' ')
  }

  const recordedAt = new Date().toISOString()
  await ensureManifestExists(id)
  const cascaded = await updateManifestAndCascade(id, (manifest) => {
    manifest.currentStation = nextStation
    manifest.financials ??= {}
    manifest.financials.offer_amount = parsed.data.amount
    manifest.financials.offer_status = 'submitted'
    manifest.deal.status = parsed.data.method
    manifest.pipeline.offer = {
      ...manifest.pipeline.offer,
      status: 'completed',
      completedAt: recordedAt,
      notes: `${parsed.data.method} offer recorded${parsed.data.notes ? `: ${parsed.data.notes}` : ''}`,
    }
    manifest.auditTrail ??= []
    manifest.auditTrail.push({
      timestamp: recordedAt,
      agent: actor,
      action: 'offer_recorded',
      details: {
        amount: parsed.data.amount,
        method: parsed.data.method,
        notes: parsed.data.notes,
        previous_amount: lead.offer_amount,
        previous_station: lead.station,
        next_station: nextStation,
      },
    })
    manifest.ariIntelligence ??= {}
    manifest.ariIntelligence.briefingStale = true
  }, 'api:lead_offer')

  const leadUpdate: Record<string, unknown> = {
    offer_amount: parsed.data.amount,
    updated_at: recordedAt,
  }
  if (!cascaded) leadUpdate.station = nextStation

  const { error: updateError } = await db.from('leads').update(leadUpdate).eq('id', id)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  const { data: activity, error: activityError } = await db
    .from('lead_activities')
    .insert({
      lead_id: id,
      activity_type: 'offer',
      description: offerActivityDescription(parsed.data),
      agent: actor,
      metadata: {
        source: 'manual_offer',
        direction: 'outbound',
        offer_amount: parsed.data.amount,
        offer_method: parsed.data.method,
        notes: parsed.data.notes,
        recorded_at: recordedAt,
        previous_amount: lead.offer_amount,
      },
    })
    .select('id, activity_type, description, agent, metadata, created_at')
    .single()

  if (activityError) {
    return NextResponse.json({
      error: 'The offer was saved, but its activity history could not be recorded. Refresh before retrying.',
      offerSaved: true,
    }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    offer: {
      amount: parsed.data.amount,
      method: parsed.data.method,
      recordedAt,
      recordedBy: actor,
      station: nextStation,
    },
    activity,
  }, { status: 201 })
}
