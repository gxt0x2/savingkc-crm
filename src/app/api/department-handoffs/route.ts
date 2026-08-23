export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { resolveAuthenticatedActor } from '@/lib/api/authenticated-actor'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { acceptDepartmentHandoff } from '@/lib/server/crm-operating-handoffs'

const DEPARTMENTS = new Set(['marketing', 'acquisitions', 'dispositions', 'transaction_coordination', 'closed'])

export async function GET(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const department = new URL(req.url).searchParams.get('department') || ''
  const status = new URL(req.url).searchParams.get('status') || 'pending'
  if (!DEPARTMENTS.has(department) || !['pending', 'accepted', 'completed'].includes(status)) {
    return NextResponse.json({ error: 'Choose a valid department and handoff status' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin()
    .from('crm_department_handoffs')
    .select('id, lead_id, from_department, to_department, status, assigned_to, reason, evidence_type, evidence_reference, target_record_type, target_record_id, created_by, accepted_by, accepted_at, created_at, leads:lead_id(id, full_name, property_address, city, state, station, assigned_agent)')
    .eq('to_department', department)
    .eq('status', status)
    .order('created_at', { ascending: false })
    .limit(25)

  if (error) {
    console.error('[department-handoffs] Read failed:', error.message)
    return NextResponse.json({ error: 'Department handoffs are unavailable' }, { status: 500 })
  }
  return NextResponse.json({ handoffs: data ?? [] }, { headers: { 'Cache-Control': 'private, no-store' } })
}

export async function PATCH(req: NextRequest) {
  const actor = await resolveAuthenticatedActor()
  if (!actor) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => null) as { handoffId?: unknown; action?: unknown } | null
  const handoffId = typeof body?.handoffId === 'string' ? body.handoffId.trim() : ''
  if (!handoffId || body?.action !== 'accept') {
    return NextResponse.json({ error: 'Choose a handoff to accept' }, { status: 400 })
  }

  try {
    const handoff = await acceptDepartmentHandoff({ handoffId, actorEmail: actor.email, actorName: actor.name })
    return NextResponse.json({ handoff })
  } catch (error) {
    console.error('[department-handoffs] Acceptance failed:', error)
    return NextResponse.json({ error: 'Department handoff could not be accepted' }, { status: 500 })
  }
}
