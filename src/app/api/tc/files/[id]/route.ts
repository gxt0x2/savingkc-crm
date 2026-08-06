export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import {
  isTcRiskLevel,
  isTcStatus,
  logTcEvent,
  maybeLogTcRevenue,
  seedStandardTcTasks,
  syncTcStatusToManifest,
} from '@/lib/tc'

const ALLOWED_FIELDS = [
  'title_company_id',
  'title_contact_id',
  'file_number',
  'status',
  'opened_at',
  'emd_due_at',
  'emd_confirmed_at',
  'title_clear_at',
  'closing_scheduled_at',
  'closing_completed_at',
  'hud_received_at',
  'assignment_fee',
  'next_action',
  'risk_level',
  'risk_reason',
  'notes',
] as const

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { data, error } = await supabaseAdmin()
      .from('tc_files')
      .select(
        `*,
        lead:lead_id(id, full_name, phone, email, property_address, city, state, zip),
        offer:buyer_offer_id(id, offer_amount, status, assignment_sent_at, assignment_signed_at, assignment_document_url, buyer:buyer_id(id, name, company, email, phone)),
        dispo_deal:dispo_deal_id(id, stage, assignment_fee, close_date),
        title_company:title_company_id(id, name, office_phone, office_email, address),
        title_contact:title_contact_id(id, name, role, email, phone),
        tasks:tc_tasks(id, task_type, label, status, due_at, completed_at, assigned_to, source, notes),
        events:tc_events(id, event_type, payload, actor, created_at)`
      )
      .eq('id', id)
      .single()

    if (error || !data) return NextResponse.json({ error: 'TC file not found' }, { status: 404 })
    return NextResponse.json({ file: data })
  } catch (err) {
    console.error('[tc/files/:id GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await req.json()
    const updates: Record<string, unknown> = {}

    for (const field of ALLOWED_FIELDS) {
      if (field in body) updates[field] = body[field]
    }

    if (typeof updates.status === 'string' && !isTcStatus(updates.status)) {
      return NextResponse.json({ error: 'Invalid TC status' }, { status: 400 })
    }
    if (typeof updates.risk_level === 'string' && !isTcRiskLevel(updates.risk_level)) {
      return NextResponse.json({ error: 'Invalid risk level' }, { status: 400 })
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No supported fields provided' }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data: current } = await db
      .from('tc_files')
      .select('id, status, dispo_deal_id')
      .eq('id', id)
      .maybeSingle()
    if (!current) return NextResponse.json({ error: 'TC file not found' }, { status: 404 })

    if (updates.status && updates.status !== current.status && updates.status !== 'not_opened') {
      updates.opened_at = updates.opened_at ?? new Date().toISOString()
    }
    if (updates.status === 'closed') {
      updates.closing_completed_at = updates.closing_completed_at ?? new Date().toISOString()
    }

    const { data: file, error } = await db
      .from('tc_files')
      .update(updates)
      .eq('id', id)
      .select()
      .single()

    if (error) {
      console.error('[tc/files/:id PATCH] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    await logTcEvent(db, id, 'tc_file_updated', updates, body.actor || 'ernest')
    if (updates.status && updates.status !== current.status) {
      await logTcEvent(db, id, `status:${current.status}->${updates.status}`, {}, body.actor || 'ernest')
    }
    if (file.status !== 'not_opened') await seedStandardTcTasks(db, id)
    if (file.status === 'closed' && file.dispo_deal_id) {
      await db.from('dispo_deals').update({ stage: 'closed', updated_at: new Date().toISOString() }).eq('id', file.dispo_deal_id)
      await maybeLogTcRevenue(db, id)
    }
    await syncTcStatusToManifest(db, id)

    return NextResponse.json({ file })
  } catch (err) {
    console.error('[tc/files/:id PATCH] error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
