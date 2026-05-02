export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { logTcEvent } from '@/lib/tc'

const updateDraftSchema = z.object({
  subject: z.string().nullable().optional(),
  edited_body: z.string().nullable().optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'sending', 'sent', 'superseded']).optional(),
  rejection_notes: z.string().nullable().optional(),
  approved_by: z.string().min(1).optional(),
  actor: z.string().min(1).optional(),
})

const draftSelect = `*,
template:template_id(id, slug, title, template_type, audience, subject, body),
file:tc_file_id(id, lead_id, status, file_number, emd_due_at, closing_scheduled_at, assignment_fee,
  lead:lead_id(id, full_name, property_address, city, state, zip),
  offer:buyer_offer_id(id, offer_amount, buyer:buyer_id(id, name, company, email, phone)),
  title_company:title_company_id(id, name, office_phone, office_email),
  title_contact:title_contact_id(id, name, role, email, phone))`

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const { data, error } = await supabaseAdmin()
      .from('tc_drafts')
      .select(draftSelect)
      .eq('id', id)
      .single()

    if (error || !data) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })
    return NextResponse.json({ draft: data })
  } catch (err) {
    console.error('[tc/drafts/:id GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const parsed = updateDraftSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const db = supabaseAdmin()
    const { data: current, error: currentError } = await db
      .from('tc_drafts')
      .select('id, tc_file_id, draft_body, edited_body, subject, status')
      .eq('id', id)
      .maybeSingle()

    if (currentError) return NextResponse.json({ error: currentError.message }, { status: 500 })
    if (!current) return NextResponse.json({ error: 'Draft not found' }, { status: 404 })

    const input = parsed.data
    const updates: Record<string, unknown> = {}
    if ('subject' in input) updates.subject = input.subject
    if ('edited_body' in input) updates.edited_body = input.edited_body
    if ('rejection_notes' in input) updates.rejection_notes = input.rejection_notes

    if (input.status) {
      updates.status = input.status
      if (input.status === 'approved') {
        updates.approved_at = new Date().toISOString()
        updates.approved_by = input.approved_by ?? input.actor ?? 'gertha'
        updates.approved_body = input.edited_body ?? current.edited_body ?? current.draft_body
        updates.rejection_notes = null
      } else if (input.status === 'rejected') {
        updates.approved_at = null
        updates.approved_by = null
        updates.approved_body = null
      } else if (input.status === 'pending') {
        updates.approved_at = null
        updates.approved_by = null
        updates.approved_body = null
        updates.sent_at = null
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No supported fields provided' }, { status: 400 })
    }

    const { data: draft, error } = await db
      .from('tc_drafts')
      .update(updates)
      .eq('id', id)
      .select(draftSelect)
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    if (input.status && input.status !== current.status) {
      await logTcEvent(db, current.tc_file_id, `draft_${input.status}`, {
        draft_id: id,
        previous_status: current.status,
      }, input.actor ?? input.approved_by ?? 'system')
    }

    return NextResponse.json({ draft })
  } catch (err) {
    console.error('[tc/drafts/:id PATCH] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
