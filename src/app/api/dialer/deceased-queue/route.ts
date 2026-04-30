import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('prospects')
    .select('lead_id, is_deceased, delinquent_years_category')
    .eq('is_deceased', true)
    .in('delinquent_years_category', ['2yr', '3yr_plus'])
    .like('parcel_id', 'SS-DEC-%')
    .not('lead_id', 'is', null)
    .limit(5000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const prospects = data ?? []
  const leadIds = Array.from(new Set(prospects.map((row) => row.lead_id).filter(Boolean)))

  return NextResponse.json({ leadIds, prospects })
}
