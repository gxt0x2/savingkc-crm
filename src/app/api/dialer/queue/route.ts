export const dynamic = 'force-dynamic'
export const revalidate = 0

import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

const NO_STORE_HEADERS: HeadersInit = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'CDN-Cache-Control': 'no-store',
  'Cloudflare-CDN-Cache-Control': 'no-store',
  Pragma: 'no-cache',
  Expires: '0',
}

const LEAD_SELECT = [
  'id',
  'full_name',
  'phone',
  'email',
  'property_address',
  'city',
  'state',
  'zip',
  'county',
  'is_favorite',
  'source',
  'station',
  'priority',
  'seller_situation',
  'motivation_score',
  'appointment_date',
  'created_at',
  'updated_at',
].join(', ')

const FOLLOWUP_TYPES = ['task', 'appointment', 'follow_up', 'callback', 'send_offer']
const CONTACT_TYPES = ['call', 'voicemail', 'sms', 'sms_sent', 'sms_received', 'sms_inbound']

function parseLeadIds(value: string | null): string[] {
  if (!value) return []
  return Array.from(new Set(
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0)
  )).slice(0, 1000)
}

async function resolveCohortLeadIds(cohort: string | null): Promise<string[]> {
  if (cohort !== 'deceased-2-3yr') return []

  const { data, error } = await supabase
    .from('prospects')
    .select('lead_id')
    .eq('is_deceased', true)
    .in('delinquent_years_category', ['2yr', '3yr_plus'])
    .not('lead_id', 'is', null)
    .limit(2000)

  if (error) throw new Error(error.message)

  return Array.from(new Set(
    (data || [])
      .map((row: { lead_id: string | null }) => row.lead_id)
      .filter((id: string | null): id is string => Boolean(id))
  ))
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const explicitLeadIds = parseLeadIds(searchParams.get('lead_ids'))
    const cohortLeadIds = explicitLeadIds.length > 0
      ? []
      : await resolveCohortLeadIds(searchParams.get('cohort'))
    const requestedLeadIds = explicitLeadIds.length > 0 ? explicitLeadIds : cohortLeadIds
    const idsOnly = searchParams.get('ids_only') === '1'
    const limitParam = Number(searchParams.get('limit') || '1000')
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 2000) : 1000

    if (idsOnly) {
      return NextResponse.json({ success: true, leadIds: requestedLeadIds }, { headers: NO_STORE_HEADERS })
    }

    const leadQuery = supabase
      .from('leads')
      .select(LEAD_SELECT)
      .not('phone', 'is', null)
      .order('updated_at', { ascending: false })
      .limit(requestedLeadIds.length > 0 ? Math.max(requestedLeadIds.length, 1) : limit)

    const { data: leadRows, error: leadError } = requestedLeadIds.length > 0
      ? await leadQuery.in('id', requestedLeadIds)
      : await leadQuery

    if (leadError) {
      return NextResponse.json({ success: false, error: leadError.message }, { status: 500, headers: NO_STORE_HEADERS })
    }

    const normalizedLeadRows = (leadRows || []) as unknown as Array<{ id: string }>
    const leadIds = Array.from(new Set(
      normalizedLeadRows
        .map((row) => row.id)
        .filter(Boolean)
    ))

    if (leadIds.length === 0) {
      return NextResponse.json(
        { success: true, leads: [], followups: [], contactActivities: [], prospects: [] },
        { headers: NO_STORE_HEADERS },
      )
    }

    const followupQuery = supabase
      .from('lead_activities')
      .select('lead_id, activity_type, metadata, created_at')
      .in('activity_type', FOLLOWUP_TYPES)
      .limit(requestedLeadIds.length > 0 ? Math.max(leadIds.length * 10, 100) : 1000)

    const contactQuery = supabase
      .from('lead_activities')
      .select('lead_id, activity_type, created_at')
      .in('activity_type', CONTACT_TYPES)
      .not('lead_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(requestedLeadIds.length > 0 ? Math.max(leadIds.length * 20, 100) : 5000)

    const prospectQuery = supabase
      .from('prospects')
      .select('id, lead_id, owner_1, cumulative_due, earliest_delinquent_year, delinquent_years_category, total_market_value, zestimate, situs_street, situs_city, situs_state, situs_zip, mailing_street, mailing_city, mailing_state, mailing_zip, county, is_deceased')
      .not('lead_id', 'is', null)
      .limit(requestedLeadIds.length > 0 ? Math.max(leadIds.length * 5, 100) : 2000)

    const [
      { data: followups, error: followupError },
      { data: contactActivities, error: contactError },
      { data: prospects, error: prospectError },
    ] = await Promise.all([
      requestedLeadIds.length > 0 ? followupQuery.in('lead_id', leadIds) : followupQuery,
      requestedLeadIds.length > 0 ? contactQuery.in('lead_id', leadIds) : contactQuery,
      requestedLeadIds.length > 0 ? prospectQuery.in('lead_id', leadIds) : prospectQuery,
    ])

    const error = followupError || contactError || prospectError
    if (error) {
      return NextResponse.json({ success: false, error: error.message }, { status: 500, headers: NO_STORE_HEADERS })
    }

    return NextResponse.json(
      {
        success: true,
        leads: normalizedLeadRows,
        followups: followups || [],
        contactActivities: contactActivities || [],
        prospects: prospects || [],
      },
      { headers: NO_STORE_HEADERS },
    )
  } catch (err) {
    console.error('[dialer/queue] Error:', err)
    return NextResponse.json({ success: false, error: 'Internal error' }, { status: 500, headers: NO_STORE_HEADERS })
  }
}
