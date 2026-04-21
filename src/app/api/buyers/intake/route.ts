export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { validateInput, buyerIntakeSchema } from '@/lib/validation-schemas'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

// ---------------------------------------------------------------------------
// OPTIONS — preflight for cross-origin intake form submissions
// ---------------------------------------------------------------------------
export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders })
}

// ---------------------------------------------------------------------------
// POST /api/buyers/intake
// Public buyer registration — no auth required.
// If the buyer already exists (matched by phone or email), update their buy_box.
// Otherwise, create a new buyer with source='intake_form' and tier='new'.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const validation = validateInput(buyerIntakeSchema, body)

    if (!validation.success) {
      return NextResponse.json(
        { success: false, error: 'Validation failed', details: validation.errors },
        { status: 400, headers: corsHeaders }
      )
    }

    const data = validation.data
    const phone = normalizePhoneToE164(data.phone)
    const email = data.email.toLowerCase()

    if (!phone) {
      return NextResponse.json(
        { success: false, error: 'Invalid phone number' },
        { status: 400, headers: corsHeaders }
      )
    }

    // Check for existing buyer by phone or email
    let existingId: string | null = null

    // Try phone first
    if (phone) {
      const { data: byPhone } = await supabaseAdmin()
        .from('buyers')
        .select('id')
        .eq('phone', phone)
        .maybeSingle()

      if (byPhone) existingId = byPhone.id
    }

    // Fall back to email check
    if (!existingId && email) {
      const { data: byEmail } = await supabaseAdmin()
        .from('buyers')
        .select('id')
        .eq('email', email)
        .maybeSingle()

      if (byEmail) existingId = byEmail.id
    }

    if (existingId) {
      // Update existing buyer's buy_box (merge in new preferences)
      const { error: updateError } = await supabaseAdmin()
        .from('buyers')
        .update({
          buy_box: data.buy_box,
          ...(data.notes ? { notes: data.notes } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingId)

      if (updateError) {
        console.error('[buyers/intake] Update error:', updateError)
        return NextResponse.json(
          { success: false, error: 'Failed to update buyer' },
          { status: 500, headers: corsHeaders }
        )
      }

      return NextResponse.json({ success: true, action: 'updated' }, { headers: corsHeaders })
    }

    // Create new buyer
    const { error: insertError } = await supabaseAdmin()
      .from('buyers')
      .insert({
        first_name: data.first_name,
        last_name: data.last_name,
        company_name: data.company_name || null,
        email,
        phone,
        buy_box: data.buy_box,
        notes: data.notes || null,
        source: 'intake_form',
        tier: 'new',
        status: 'active',
      })

    if (insertError) {
      console.error('[buyers/intake] Insert error:', insertError)
      return NextResponse.json(
        { success: false, error: 'Failed to register buyer' },
        { status: 500, headers: corsHeaders }
      )
    }

    return NextResponse.json({ success: true, action: 'created' }, { status: 201, headers: corsHeaders })
  } catch (err) {
    console.error('[buyers/intake] Unexpected error:', err)
    return NextResponse.json(
      { success: false, error: 'Internal error' },
      { status: 500, headers: corsHeaders }
    )
  }
}
