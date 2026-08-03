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
  'station',
  'classification',
  'priority',
  'motivation_score',
  'appointment_date',
  'updated_at',
  'created_at',
].join(', ')

export async function GET(req: NextRequest) {
  try {
    await requireMobileUser(req)
    const { searchParams } = new URL(req.url)
    const rawLimit = Number(searchParams.get('limit') || '25')
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 25

    const db = supabaseAdmin()
    const { data, error } = await db
      .from('leads')
      .select(LEAD_SELECT)
      .or('station.is.null,station.not.in.(dead,closed_lost)')
      .or('classification.is.null,classification.neq.dead')
      .order('updated_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500, headers: mobileNoStoreHeaders() },
      )
    }

    return NextResponse.json({ leads: data || [] }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
