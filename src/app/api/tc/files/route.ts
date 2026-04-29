export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ensureTcFileForOffer, isTcStatus } from '@/lib/tc'

const createSchema = z.object({
  lead_id: z.string().uuid().optional(),
  buyer_offer_id: z.string().uuid(),
  dispo_deal_id: z.string().uuid().optional(),
  status: z.string().optional(),
})

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const risk = searchParams.get('risk')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200)
    const db = supabaseAdmin()

    let query = db
      .from('tc_files')
      .select(
        `*,
        lead:lead_id(id, full_name, property_address, city, state, zip),
        offer:buyer_offer_id(id, offer_amount, status, assignment_sent_at, assignment_signed_at, assignment_document_url, buyer:buyer_id(id, name, company, email, phone)),
        dispo_deal:dispo_deal_id(id, stage, assignment_fee, close_date),
        title_company:title_company_id(id, name, office_phone, office_email),
        title_contact:title_contact_id(id, name, role, email, phone),
        tasks:tc_tasks(id, task_type, label, status, due_at, completed_at, assigned_to, source, notes)`
      )
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (risk && risk !== 'all') query = query.eq('risk_level', risk)

    const { data, error } = await query
    if (error) {
      console.error('[tc/files GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ files: data ?? [] })
  } catch (err) {
    console.error('[tc/files GET] error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const parsed = createSchema.safeParse(await req.json())
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }
    const status = parsed.data.status
    const statusValue = status && isTcStatus(status) ? status : undefined
    if (status && !statusValue) {
      return NextResponse.json({ error: 'Invalid TC status' }, { status: 400 })
    }

    const file = await ensureTcFileForOffer(supabaseAdmin(), parsed.data.buyer_offer_id, {
      status: statusValue,
      actor: 'ernest',
      eventType: 'tc_file_created_from_api',
      seedTasks: status !== 'not_opened',
    })

    if (!file) return NextResponse.json({ error: 'Offer not found' }, { status: 404 })
    return NextResponse.json({ file }, { status: 201 })
  } catch (err) {
    console.error('[tc/files POST] error:', err)
    const msg = err instanceof Error ? err.message : 'Internal error'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
