export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin()
    .from('leads')
    .select(
      'id, full_name, phone, email, property_address, city, state, zip, county, ' +
      'property_type, beds, baths_full, baths_half, sqft, lot_size, year_built, ' +
      'arv, offer_amount, asking_price, repair_estimate, assignment_fee, ' +
      'garage_spaces, basement_type, stories, roof_type, heating, cooling, ' +
      'zoning, hoa_amount, tax_assessment, last_sale_date, last_sale_price'
    )
    .eq('id', id)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Lead not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}
