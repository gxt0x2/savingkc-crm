import { NextRequest, NextResponse } from 'next/server'

import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireMobileUser(req)
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: mobileNoStoreHeaders() })

    const db = supabaseAdmin()
    const [leadResult, activityResult] = await Promise.all([
      db.from('leads').select('id, full_name, phone, email, property_address, city, state, zip, station, priority, assigned_agent, classification, dead_reason, source, updated_at').eq('id', id).maybeSingle(),
      db.from('lead_activities').select('id, activity_type, description, agent, metadata, created_at').eq('lead_id', id).in('activity_type', ['call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'voicemail', 'note']).order('created_at', { ascending: false }).limit(100),
    ])
    if (leadResult.error) throw new Error(leadResult.error.message)
    if (!leadResult.data) return NextResponse.json({ error: 'Contact not found' }, { status: 404, headers: mobileNoStoreHeaders() })
    if (activityResult.error) throw new Error(activityResult.error.message)

    return NextResponse.json({ contact: leadResult.data, activities: activityResult.data ?? [] }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
