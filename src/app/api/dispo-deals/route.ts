export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

// ---------------------------------------------------------------------------
// Bootstrap: create dispo_deals table if missing
// ---------------------------------------------------------------------------
let bootstrapped = false
async function ensureTable() {
  if (bootstrapped) return
  const db = supabaseAdmin()
  try {
    await db.rpc('exec_sql', {
      sql_query: `
        CREATE TABLE IF NOT EXISTS dispo_deals (
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
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );

        CREATE INDEX IF NOT EXISTS idx_dispo_deals_stage ON dispo_deals(stage);
        CREATE INDEX IF NOT EXISTS idx_dispo_deals_lead ON dispo_deals(lead_id);
      `,
    })
    bootstrapped = true
  } catch (e) {
    console.error('[dispo-deals] Bootstrap error (may be OK if table exists):', e)
    bootstrapped = true
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
        '*, leads:lead_id(id, full_name, property_address, city, state, zip, arv, offer_amount, property_type, beds, baths_full, sqft)',
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

    // Enrich each deal with deal_page, broadcasts_count, offers_count
    const enriched = await Promise.all(
      (deals ?? []).map(async (deal) => {
        // Get deal page for this lead
        const { data: dealPage } = await db
          .from('deal_pages')
          .select('id, slug, is_active')
          .eq('lead_id', deal.lead_id)
          .limit(1)
          .maybeSingle()

        // Count broadcasts
        const { count: bcCount } = await db
          .from('deal_broadcasts')
          .select('id', { count: 'exact', head: true })
          .eq('lead_id', deal.lead_id)

        // Count offers
        const { count: offerCount } = await db
          .from('buyer_offers')
          .select('id', { count: 'exact', head: true })
          .eq('lead_id', deal.lead_id)

        // Get accepted buyer if applicable
        let accepted_buyer = null
        if (deal.accepted_buyer_id) {
          const { data: buyer } = await db
            .from('buyers')
            .select('id, first_name, last_name, company_name, name, company')
            .eq('id', deal.accepted_buyer_id)
            .single()
          if (buyer) {
            const nameParts = (buyer.name ?? '').split(' ')
            accepted_buyer = {
              id: buyer.id,
              first_name: buyer.first_name ?? nameParts[0] ?? '',
              last_name: buyer.last_name ?? nameParts.slice(1).join(' ') ?? '',
              company_name: buyer.company_name ?? buyer.company ?? null,
            }
          }
        }

        return {
          ...deal,
          deal_page: dealPage ?? null,
          broadcasts_count: bcCount ?? 0,
          offers_count: offerCount ?? 0,
          accepted_buyer,
        }
      })
    )

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

    return NextResponse.json({ deal }, { status: 201 })
  } catch (err) {
    console.error('[dispo-deals POST] Unexpected error:', err)
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
