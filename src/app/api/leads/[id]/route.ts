export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const db = supabaseAdmin()

  // Fetch lead + manifest in parallel
  const [leadRes, manifestRes] = await Promise.all([
    db.from('leads')
      .select(
        'id, full_name, phone, email, property_address, city, state, zip, county, ' +
        'property_type, beds, baths_full, baths_half, sqft, lot_size, year_built, ' +
        'arv, offer_amount, asking_price, repair_estimate, assignment_fee, ' +
        'garage_spaces, basement_type, stories, roof_type, heating, cooling, ' +
        'zoning, hoa_amount, tax_assessment, last_sale_date, last_sale_price'
      )
      .eq('id', id)
      .single(),
    db.from('manifests')
      .select('data')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  if (leadRes.error || !leadRes.data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lead = leadRes.data as any
  return NextResponse.json({
    ...lead,
    manifest: (manifestRes.data as any)?.data ?? null,
  })
}
