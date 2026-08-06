export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ensureTcFileForDeal } from '@/lib/tc'

// ---------------------------------------------------------------------------
// Bootstrap: create dispo_deals table if missing
// ---------------------------------------------------------------------------
let bootstrapped = false
async function ensureTable() {
  if (bootstrapped) return
  if (process.env.VERCEL_ENV === 'preview') return
  const db = supabaseAdmin()

  const statements = [
    `CREATE TABLE IF NOT EXISTS dispo_deals (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lead_id uuid NOT NULL REFERENCES leads(id),
      stage text NOT NULL DEFAULT 'new'
        CHECK (stage IN ('new','marketing','offers_in','negotiating','under_contract','closed','dead')),
      entered_at timestamptz NOT NULL DEFAULT now(),
      assignment_fee numeric,
      close_date date,
      accepted_offer_id uuid,
      accepted_buyer_id uuid,
      notes text,
      closeout_status text NOT NULL DEFAULT 'not_started',
      closeout jsonb NOT NULL DEFAULT '{}'::jsonb,
      closed_at timestamptz,
      debrief_due_at timestamptz,
      debrief_completed_at timestamptz,
      archived_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`,
    `ALTER TABLE dispo_deals ADD COLUMN IF NOT EXISTS closeout_status text NOT NULL DEFAULT 'not_started'`,
    `ALTER TABLE dispo_deals ADD COLUMN IF NOT EXISTS closeout jsonb NOT NULL DEFAULT '{}'::jsonb`,
    `ALTER TABLE dispo_deals ADD COLUMN IF NOT EXISTS closed_at timestamptz`,
    `ALTER TABLE dispo_deals ADD COLUMN IF NOT EXISTS debrief_due_at timestamptz`,
    `ALTER TABLE dispo_deals ADD COLUMN IF NOT EXISTS debrief_completed_at timestamptz`,
    `ALTER TABLE dispo_deals ADD COLUMN IF NOT EXISTS archived_at timestamptz`,
    `CREATE INDEX IF NOT EXISTS idx_dispo_deals_stage ON dispo_deals(stage)`,
    `CREATE INDEX IF NOT EXISTS idx_dispo_deals_lead ON dispo_deals(lead_id)`,
  ]

  try {
    for (const sql of statements) {
      const { error } = await db.rpc('exec_sql', { sql_query: sql })
      if (error) {
        console.error('[dispo-deals] Bootstrap SQL error:', error.message)
      }
    }
    bootstrapped = true
  } catch (e) {
    console.error('[dispo-deals] Bootstrap error:', e)
    // Check if table exists by trying a count
    const { error: testErr } = await db.from('dispo_deals').select('id', { count: 'exact', head: true })
    if (!testErr) {
      bootstrapped = true
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/dispo-deals?stage=xxx&search=xxx
// List dispo deals with lead info, deal page, broadcast/offer counts
// ---------------------------------------------------------------------------
export async function GET(req: NextRequest) {
  try {
    await ensureTable()
    const { searchParams } = new URL(req.url)
    const stage = searchParams.get('stage')
    const search = searchParams.get('search')
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    const db = supabaseAdmin()

    let query = db
      .from('dispo_deals')
      .select(
        '*, leads:lead_id(id, full_name, property_address, city, state, zip, arv, offer_amount, property_type, beds, baths_full, sqft, source, assigned_agent, created_at)',
        { count: 'exact' }
      )
      .order('updated_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (stage && stage !== 'all') {
      query = query.eq('stage', stage)
    }

    const { data: deals, error, count } = await query

    if (error) {
      console.error('[dispo-deals GET] Supabase error:', error)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const dealRows = deals ?? []
    if (dealRows.length === 0) return NextResponse.json({ deals: [], total: count ?? 0 })

    const leadIds = [...new Set(dealRows.map((deal) => deal.lead_id))]
    const dealIds = dealRows.map((deal) => deal.id)
    const acceptedBuyerIds = [...new Set(dealRows.map((deal) => deal.accepted_buyer_id).filter(Boolean))] as string[]
    const [dealPagesResult, broadcastsResult, offersResult, tcFilesResult, buyersResult] = await Promise.all([
      db.from('deal_pages').select('id, lead_id, slug, is_active').in('lead_id', leadIds),
      db.from('deal_broadcasts').select('id, lead_id').in('lead_id', leadIds),
      db.from('buyer_offers').select('id, lead_id').in('lead_id', leadIds),
      db
        .from('tc_files')
        .select('id, dispo_deal_id, status, risk_level, next_action, closing_scheduled_at, file_number, tasks:tc_tasks(id, tc_file_id, task_type, label, status, due_at, completed_at, assigned_to, source, notes, created_at, updated_at)')
        .in('dispo_deal_id', dealIds)
        .order('updated_at', { ascending: false }),
      acceptedBuyerIds.length > 0
        ? db.from('buyers').select('id, first_name, last_name, company_name, name, company').in('id', acceptedBuyerIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    const dealPageByLead = new Map<string, NonNullable<typeof dealPagesResult.data>[number]>()
    for (const dealPage of dealPagesResult.data ?? []) {
      if (!dealPageByLead.has(dealPage.lead_id)) dealPageByLead.set(dealPage.lead_id, dealPage)
    }
    const broadcastCountByLead = new Map<string, number>()
    for (const broadcast of broadcastsResult.data ?? []) {
      broadcastCountByLead.set(broadcast.lead_id, (broadcastCountByLead.get(broadcast.lead_id) ?? 0) + 1)
    }
    const offerCountByLead = new Map<string, number>()
    for (const offer of offersResult.data ?? []) {
      offerCountByLead.set(offer.lead_id, (offerCountByLead.get(offer.lead_id) ?? 0) + 1)
    }
    const tcFileByDeal = new Map<string, NonNullable<typeof tcFilesResult.data>[number]>()
    for (const tcFile of tcFilesResult.data ?? []) {
      if (tcFile.dispo_deal_id && !tcFileByDeal.has(tcFile.dispo_deal_id)) tcFileByDeal.set(tcFile.dispo_deal_id, tcFile)
    }
    const buyerById = new Map((buyersResult.data ?? []).map((buyer) => [buyer.id, buyer]))

    const enriched = dealRows.map((deal) => {
      const buyer = deal.accepted_buyer_id ? buyerById.get(deal.accepted_buyer_id) : null
      const nameParts = (buyer?.name ?? '').split(' ').filter(Boolean)
      return {
        ...deal,
        deal_page: dealPageByLead.get(deal.lead_id) ?? null,
        tc_file: tcFileByDeal.get(deal.id) ?? null,
        broadcasts_count: broadcastCountByLead.get(deal.lead_id) ?? 0,
        offers_count: offerCountByLead.get(deal.lead_id) ?? 0,
        accepted_buyer: buyer ? {
          id: buyer.id,
          first_name: buyer.first_name ?? nameParts[0] ?? '',
          last_name: buyer.last_name ?? nameParts.slice(1).join(' '),
          company_name: buyer.company_name ?? buyer.company ?? null,
        } : null,
      }
    })

    // Apply search filter post-fetch (on lead address/name)
    let results = enriched
    if (search) {
      const q = search.toLowerCase()
      results = enriched.filter((d) => {
        const lead = d.leads as Record<string, unknown> | null
        if (!lead) return false
        const addr = String(lead.property_address ?? '').toLowerCase()
        const name = String(lead.full_name ?? '').toLowerCase()
        const city = String(lead.city ?? '').toLowerCase()
        return addr.includes(q) || name.includes(q) || city.includes(q)
      })
    }

    return NextResponse.json({ deals: results, total: count ?? 0 })
  } catch (err) {
    console.error('[dispo-deals GET] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}

// ---------------------------------------------------------------------------
// POST /api/dispo-deals
// Add a lead to the dispo pipeline. Body: { lead_id, notes? }
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    await ensureTable()
    const body = await req.json()
    const { lead_id, notes } = body

    if (!lead_id) {
      return NextResponse.json({ error: 'lead_id is required' }, { status: 400 })
    }

    const db = supabaseAdmin()

    // Check lead exists
    const { data: lead, error: leadError } = await db
      .from('leads')
      .select('id, property_address')
      .eq('id', lead_id)
      .single()

    if (leadError || !lead) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
    }

    // Check not already in dispo
    const { data: existing } = await db
      .from('dispo_deals')
      .select('id')
      .eq('lead_id', lead_id)
      .limit(1)
      .maybeSingle()

    if (existing) {
      return NextResponse.json({ error: 'Lead already in dispo pipeline', deal_id: existing.id }, { status: 409 })
    }

    // Insert
    const { data: deal, error: insertError } = await db
      .from('dispo_deals')
      .insert({
        lead_id,
        stage: 'new',
        notes: notes || null,
      })
      .select()
      .single()

    if (insertError) {
      console.error('[dispo-deals POST] Insert error:', insertError)
      return NextResponse.json({ error: insertError.message }, { status: 500 })
    }

    await ensureTcFileForDeal(db, {
      id: deal.id,
      leadId: deal.lead_id,
      stage: deal.stage,
      enteredAt: deal.entered_at,
      assignmentFee: deal.assignment_fee,
      closeDate: deal.close_date,
      acceptedOfferId: deal.accepted_offer_id,
    })

    return NextResponse.json({ deal }, { status: 201 })
  } catch (err) {
    console.error('[dispo-deals POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
