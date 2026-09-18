import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileActor } from '@/lib/mobile-api/auth'
import { completeMobileCommand, mobileCommandPayloadHash, reserveMobileCommand } from '@/lib/mobile-api/command-receipts'
import { buildLeadActivityInsert } from '@/lib/server/lead-activity-command'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export function OPTIONS() { return mobileOptionsResponse() }

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { actor } = await requireMobileActor(req)
    const { id } = await params
    const key = req.headers.get('idempotency-key')?.trim() || ''
    if (key.length < 8 || key.length > 200) return NextResponse.json({ error: 'A stable Idempotency-Key is required' }, { status: 400, headers: mobileNoStoreHeaders() })
    const body = await req.json().catch(() => null) as { description?: unknown } | null
    const command = buildLeadActivityInsert(id, actor.name, { kind: 'note', description: body?.description })
    if (!command.ok) return NextResponse.json({ error: command.error }, { status: 400, headers: mobileNoStoreHeaders() })
    command.insert.metadata = { ...command.insert.metadata, actor_email: actor.email, idempotency_key: key, source: 'mobile_app' }
    const reservation = await reserveMobileCommand({
      actorEmail: actor.email, idempotencyKey: key, command: 'add_note', leadId: id,
      payloadHash: mobileCommandPayloadHash({ leadId: id, description: command.insert.description }),
    })
    if (reservation.kind === 'conflict') return NextResponse.json({ error: 'That Idempotency-Key belongs to a different note' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'pending') return NextResponse.json({ error: 'This note is already processing. Refresh before retrying.', code: 'operation_pending' }, { status: 409, headers: mobileNoStoreHeaders() })
    if (reservation.kind === 'replay') return NextResponse.json(reservation.result, { status: reservation.status, headers: mobileNoStoreHeaders() })

    const { data, error } = await supabaseAdmin().from('lead_activities').insert(command.insert)
      .select('id,lead_id,activity_type,description,agent,metadata,created_at').single()
    if (error || !data) throw new Error(error?.message || 'Note insert returned no activity')
    const result = { success: true, activity: data }
    try {
      await completeMobileCommand({ actorEmail: actor.email, idempotencyKey: key, status: 201, result })
    } catch (error) {
      console.error('[mobile/note] receipt completion failed:', error)
      return NextResponse.json({ ...result, warning: 'Note saved, but retry reconciliation is pending. Refresh before retrying.' }, { status: 201, headers: mobileNoStoreHeaders() })
    }
    return NextResponse.json(result, { status: 201, headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 503
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Note could not be saved.' }, { status, headers: mobileNoStoreHeaders() })
  }
}
