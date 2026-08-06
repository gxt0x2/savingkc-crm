export const dynamic = 'force-dynamic'

import { after, NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ensureTcFileForOffer, isTcStatus, seedDispositionOperatingTasks } from '@/lib/tc'
import { isNonRealRecord } from '@/lib/real-data'
import type { TcStatus } from '@/types/dispo'

const createSchema = z.object({
  lead_id: z.string().uuid().optional(),
  buyer_offer_id: z.string().uuid(),
  dispo_deal_id: z.string().uuid().optional(),
  status: z.string().optional(),
})

const TC_PIPELINE_STAGES = ['new', 'marketing', 'offers_in', 'negotiating', 'under_contract'] as const

interface PipelineDealRow {
  id: string
  lead_id: string
  stage: (typeof TC_PIPELINE_STAGES)[number]
  assignment_fee: number | null
  close_date: string | null
  accepted_offer_id: string | null
  updated_at: string
  lead: PipelineLeadRow | PipelineLeadRow[] | null
}

interface PipelineLeadRow {
  id: string
  full_name: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
}

function normalizeLead(lead: PipelineDealRow['lead']) {
  return Array.isArray(lead) ? lead[0] ?? null : lead
}

function initialStatusForDeal(stage: PipelineDealRow['stage']): TcStatus {
  return stage === 'under_contract' ? 'opening_package_needed' : 'not_opened'
}

function nextActionForDeal(stage: PipelineDealRow['stage']) {
  const map: Record<PipelineDealRow['stage'], string> = {
    new: 'Confirm dispo intake and prep marketing package',
    marketing: 'Monitor buyer response and call agenda',
    offers_in: 'Review offers and prep accepted-offer handoff',
    negotiating: 'Track negotiations and prep assignment handoff',
    under_contract: 'Send assignment contract and open with title',
  }
  return map[stage]
}

function closingDateToTimestamp(value: string | null) {
  if (!value) return null
  return new Date(`${value}T17:00:00.000Z`).toISOString()
}

async function syncPipelineDealsIntoTcFiles(db: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await db
    .from('dispo_deals')
    .select(
      `id, lead_id, stage, assignment_fee, close_date, accepted_offer_id, updated_at,
      lead:lead_id(id, full_name, phone, email, property_address, city, state, zip)`
    )
    .in('stage', TC_PIPELINE_STAGES)
    .limit(300)

  if (error) throw new Error(error.message)

  const deals = ((data ?? []) as PipelineDealRow[]).filter((deal) => {
    const lead = normalizeLead(deal.lead)
    return !isNonRealRecord(
      lead?.full_name,
      lead?.property_address,
      lead?.city,
      lead?.state,
    )
  })

  if (deals.length === 0) return

  const dealIds = deals.map((deal) => deal.id)
  const { data: existing, error: existingError } = await db
    .from('tc_files')
    .select('id, dispo_deal_id')
    .in('dispo_deal_id', dealIds)

  if (existingError) throw new Error(existingError.message)

  const existingDealIds = new Set((existing ?? []).map((file) => file.dispo_deal_id).filter(Boolean))
  const rows = deals
    .filter((deal) => !existingDealIds.has(deal.id))
    .map((deal) => ({
      lead_id: deal.lead_id,
      dispo_deal_id: deal.id,
      buyer_offer_id: deal.accepted_offer_id,
      status: initialStatusForDeal(deal.stage),
      opened_at: deal.stage === 'under_contract' ? new Date().toISOString() : null,
      closing_scheduled_at: closingDateToTimestamp(deal.close_date),
      assignment_fee: deal.assignment_fee,
      next_action: nextActionForDeal(deal.stage),
      risk_level: 'normal',
    }))

  if (rows.length === 0) return

  const { data: created, error: createError } = await db
    .from('tc_files')
    .insert(rows)
    .select('id, dispo_deal_id')

  if (createError) throw new Error(createError.message)

  const events = (created ?? []).map((file) => ({
    tc_file_id: file.id,
    event_type: 'tc_file_synced_from_dispo_pipeline',
    payload: { dispo_deal_id: file.dispo_deal_id },
    actor: 'system',
  }))

  if (events.length > 0) {
    const { error: eventError } = await db.from('tc_events').insert(events)
    if (eventError) console.error('[tc/files GET] pipeline sync event failed:', eventError.message)
  }
}

async function syncOperatingTasks(db: ReturnType<typeof supabaseAdmin>) {
  const { data, error } = await db
    .from('tc_files')
    .select('id, status, created_at, closing_scheduled_at, dispo_deal:dispo_deal_id(stage, entered_at, close_date)')
    .not('dispo_deal_id', 'is', null)
    .limit(300)
  if (error) throw new Error(error.message)

  const contexts = (data ?? []).flatMap((file) => {
    const deal = Array.isArray(file.dispo_deal) ? file.dispo_deal[0] : file.dispo_deal
    if (!deal?.stage || deal.stage === 'dead') return []
    return [{
      tcFileId: file.id,
      dealStage: deal.stage,
      tcStatus: file.status,
      enteredAt: deal.entered_at || file.created_at,
      closingAt: file.closing_scheduled_at || (deal.close_date ? `${deal.close_date}T17:00:00.000Z` : null),
    }]
  })
  await seedDispositionOperatingTasks(db, contexts)
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const risk = searchParams.get('risk')
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 200)
    const db = supabaseAdmin()

    if (process.env.VERCEL_ENV !== 'preview') {
      after(async () => {
        try {
          const backgroundDb = supabaseAdmin()
          await syncPipelineDealsIntoTcFiles(backgroundDb)
          await syncOperatingTasks(backgroundDb)
        } catch (backgroundError) {
          console.error('[tc/files GET] operating workflow sync failed:', backgroundError)
        }
      })
    }

    let query = db
      .from('tc_files')
      .select(
        `*,
        lead:lead_id(id, full_name, phone, email, property_address, city, state, zip),
        offer:buyer_offer_id(id, offer_amount, status, close_days, assignment_submission_id, assignment_assignee_submitter_id, assignment_sent_at, assignment_signed_at, assignment_document_url, buyer:buyer_id(id, name, company, email, phone)),
        dispo_deal:dispo_deal_id(id, stage, entered_at, assignment_fee, close_date, accepted_offer_id, accepted_buyer_id),
        title_company:title_company_id(id, name, office_phone, office_email),
        title_contact:title_contact_id(id, name, role, email, phone),
        tasks:tc_tasks(id, task_type, label, status, due_at, completed_at, assigned_to, source, notes)`
      )
      .not('dispo_deal_id', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(limit)

    if (status && status !== 'all') query = query.eq('status', status)
    if (risk && risk !== 'all') query = query.eq('risk_level', risk)

    const { data, error } = await query
    if (error) {
      console.error('[tc/files GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const files = (data ?? []).filter((file) => {
      const lead = Array.isArray(file.lead) ? file.lead[0] : file.lead
      const offer = Array.isArray(file.offer) ? file.offer[0] : file.offer
      const buyer = Array.isArray(offer?.buyer) ? offer?.buyer[0] : offer?.buyer
      const deal = Array.isArray(file.dispo_deal) ? file.dispo_deal[0] : file.dispo_deal
      if (!deal || deal.stage === 'dead') return false

      return !isNonRealRecord(
        lead?.full_name,
        lead?.property_address,
        buyer?.name,
        buyer?.company,
        buyer?.email,
      )
    })

    return NextResponse.json({ files })
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
