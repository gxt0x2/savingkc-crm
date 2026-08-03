import { NextRequest, NextResponse } from 'next/server'
import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
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
  'station',
  'classification',
  'dead_reason',
  'priority',
  'motivation_score',
  'seller_situation',
  'appointment_date',
  'updated_at',
  'created_at',
].join(', ')

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireMobileUser(req)
    const { id } = await params
    if (!id) {
      return NextResponse.json({ error: 'id required' }, { status: 400, headers: mobileNoStoreHeaders() })
    }

    const db = supabaseAdmin()
    const [leadRes, activityRes] = await Promise.all([
      db.from('leads').select(LEAD_SELECT).eq('id', id).maybeSingle(),
      db
        .from('lead_activities')
        .select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(10),
    ])

    if (leadRes.error) {
      return NextResponse.json(
        { error: leadRes.error.message },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    if (!leadRes.data) {
      return NextResponse.json({ error: 'Lead not found' }, { status: 404, headers: mobileNoStoreHeaders() })
    }

    if (activityRes.error) {
      return NextResponse.json(
        { error: activityRes.error.message },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    return NextResponse.json(
      { lead: leadRes.data, activities: activityRes.data || [] },
      { headers: mobileNoStoreHeaders() },
    )
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
