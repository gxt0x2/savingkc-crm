export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'

import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { parseLeadOfferInput } from '@/lib/lead-offer'
import { supabaseAdmin } from '@/lib/supabase/admin'

type OfferCommandResult = {
  activity: {
    id: string
    activity_type: string
    description: string
    agent: string
    metadata: Record<string, unknown>
    created_at: string
  }
  amount: number
  stage: string
  replayed: boolean
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isOfferCommandResult(value: unknown): value is OfferCommandResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const result = value as Partial<OfferCommandResult>
  return Boolean(
    result.activity
      && typeof result.activity === 'object'
      && typeof result.activity.id === 'string'
      && typeof result.activity.created_at === 'string'
      && typeof result.amount === 'number'
      && typeof result.stage === 'string'
      && typeof result.replayed === 'boolean',
  )
}

function offerCommandError(message: string): { error: string; status: number } {
  if (message.includes('lead_not_found')) return { error: 'Lead not found.', status: 404 }
  if (message.includes('terminal_lead_cannot_receive_offer')) {
    return { error: 'Reopen this contact before recording an offer.', status: 409 }
  }
  if (message.includes('offer_command_conflict')) {
    return { error: 'This offer request conflicts with an offer already recorded. Refresh before retrying.', status: 409 }
  }
  if (message.includes('invalid_offer_') || message.includes('offer_notes_too_long')) {
    return { error: 'The offer details are invalid.', status: 400 }
  }
  return { error: 'The offer could not be recorded. Nothing was changed.', status: 503 }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!id || !UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'A valid lead id is required.' }, { status: 400 })
  }

  const parsed = parseLeadOfferInput(await request.json().catch(() => null))
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error }, { status: 400 })
  }

  const commandId = request.headers.get('idempotency-key')?.trim() || crypto.randomUUID()
  if (!UUID_PATTERN.test(commandId)) {
    return NextResponse.json({ error: 'Idempotency key must be a UUID.' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin().rpc('record_crm_lead_offer_v1', {
    target_lead_id: id,
    target_command_id: commandId,
    target_amount: parsed.data.amount,
    target_method: parsed.data.method,
    target_notes: parsed.data.notes,
    target_actor_email: actor.email,
    target_actor_name: actor.name,
  })

  if (error) {
    console.error('[lead-offer] atomic command failed:', error.message)
    const mapped = offerCommandError(error.message)
    return NextResponse.json({ error: mapped.error }, { status: mapped.status })
  }
  if (!isOfferCommandResult(data)) {
    console.error('[lead-offer] atomic command returned an invalid result')
    return NextResponse.json({ error: 'The offer could not be confirmed. Nothing was changed.' }, { status: 503 })
  }

  return NextResponse.json({
    success: true,
    offer: {
      amount: data.amount,
      method: parsed.data.method,
      recordedAt: data.activity.created_at,
      recordedBy: data.activity.agent || actor.name,
      station: data.stage,
    },
    activity: data.activity,
    replayed: data.replayed,
  }, { status: data.replayed ? 200 : 201 })
}
