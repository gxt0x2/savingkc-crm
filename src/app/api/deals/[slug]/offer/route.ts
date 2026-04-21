export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { validateInput, buyerOfferSchema } from '@/lib/validation-schemas'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

// ---------------------------------------------------------------------------
// POST /api/deals/:slug/offer (PUBLIC)
// Submit an offer on a deal page. Validates with buyerOfferSchema.
// Finds or creates buyer by phone/email, inserts buyer_offers.
// ---------------------------------------------------------------------------
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params
    const body = await req.json()

    // Validate input
    const validation = validateInput(buyerOfferSchema, body)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.errors },
        { status: 400, headers: corsHeaders }
      )
    }

    const data = validation.data
    const db = supabaseAdmin()

    // Fetch the deal page
    const { data: dealPage, error: dealError } = await db
      .from('deal_pages')
      .select('id, lead_id, slug')
      .eq('slug', slug)
      .eq('status', 'active')
      .single()

    if (dealError || !dealPage) {
      return NextResponse.json(
        { error: 'Deal not found' },
        { status: 404, headers: corsHeaders }
      )
    }

    // Find or create buyer by phone/email
    const normalizedPhone = normalizePhoneToE164(data.buyer_phone)
    let buyerId: string | null = null

    // Try to find existing buyer by phone first
    if (normalizedPhone) {
      const { data: existingByPhone } = await db
        .from('buyers')
        .select('id')
        .eq('phone', normalizedPhone)
        .limit(1)
        .single()

      if (existingByPhone) {
        buyerId = existingByPhone.id
      }
    }

    // If not found by phone, try email
    if (!buyerId && data.buyer_email) {
      const { data: existingByEmail } = await db
        .from('buyers')
        .select('id')
        .eq('email', data.buyer_email.toLowerCase())
        .limit(1)
        .single()

      if (existingByEmail) {
        buyerId = existingByEmail.id
      }
    }

    // Create new buyer if not found
    if (!buyerId) {
      const nameParts = data.buyer_name.trim().split(/\s+/)
      const firstName = nameParts[0]
      const lastName = nameParts.slice(1).join(' ') || ''

      const { data: newBuyer, error: buyerError } = await db
        .from('buyers')
        .insert({
          first_name: firstName,
          last_name: lastName,
          phone: normalizedPhone,
          email: data.buyer_email.toLowerCase(),
          status: 'active',
          tier: 'new',
          source: 'deal_page_offer',
          sms_opted_in: true,
          email_opted_in: true,
          deals_closed: 0,
        })
        .select('id')
        .single()

      if (buyerError) {
        console.error('[deals/:slug/offer] Create buyer error:', buyerError)
        return NextResponse.json(
          { error: 'Failed to create buyer record' },
          { status: 500, headers: corsHeaders }
        )
      }

      buyerId = newBuyer.id
    }

    // Insert offer
    const { data: offer, error: offerError } = await db
      .from('buyer_offers')
      .insert({
        deal_page_id: dealPage.id,
        lead_id: dealPage.lead_id,
        buyer_id: buyerId,
        offer_amount: data.offer_amount,
        earnest_money: data.earnest_money || null,
        close_days: data.close_days || null,
        inspection_days: data.inspection_days || null,
        financing_type: data.financing_type || null,
        contingencies: data.contingencies || null,
        notes: data.notes || null,
        status: 'pending',
      })
      .select()
      .single()

    if (offerError) {
      console.error('[deals/:slug/offer] Insert offer error:', offerError)
      return NextResponse.json(
        { error: 'Failed to submit offer' },
        { status: 500, headers: corsHeaders }
      )
    }

    // Increment offers_received on any broadcast linked to this lead
    const { data: broadcasts } = await db
      .from('deal_broadcasts')
      .select('id, offers_received')
      .eq('lead_id', dealPage.lead_id)
      .eq('status', 'sent')

    if (broadcasts && broadcasts.length > 0) {
      // Increment on the most recent broadcast
      const latest = broadcasts[0]
      await db
        .from('deal_broadcasts')
        .update({ offers_received: (latest.offers_received || 0) + 1 })
        .eq('id', latest.id)
    }

    return NextResponse.json(
      {
        success: true,
        offer_id: offer.id,
        message: 'Offer submitted successfully. We will review and get back to you shortly.',
      },
      { status: 201, headers: corsHeaders }
    )
  } catch (err) {
    console.error('[deals/:slug/offer POST] Unexpected error:', err)
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
