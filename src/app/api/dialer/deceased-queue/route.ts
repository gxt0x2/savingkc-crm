import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'

export async function GET() {
  const supabase = supabaseAdmin()
  const { data, error } = await supabase
    .from('prospects')
    .select('lead_id, is_deceased, delinquent_years_category')
    .eq('is_deceased', true)
    .in('delinquent_years_category', ['2yr', '3yr_plus'])
    .not('lead_id', 'is', null)
    .limit(5000)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const prospects = data ?? []
  const candidateLeadIds = Array.from(new Set(prospects.map((row) => row.lead_id).filter(Boolean)))
  if (candidateLeadIds.length === 0) {
    return NextResponse.json({ leadIds: [], prospects: [] })
  }

  const { data: leads, error: leadError } = await supabase
    .from('leads')
    .select('id, county, source')
    .in('id', candidateLeadIds)
    .eq('county', 'johnson')
    .eq('source', 'manual')

  if (leadError) {
    return NextResponse.json({ error: leadError.message }, { status: 500 })
  }

  const leadIds = Array.from(new Set((leads ?? []).map((row) => row.id).filter(Boolean)))
  const leadIdSet = new Set(leadIds)
  const filteredProspects = prospects.filter((row) => row.lead_id && leadIdSet.has(row.lead_id))

  return NextResponse.json({ leadIds, prospects: filteredProspects })
}
