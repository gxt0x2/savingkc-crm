import { NextRequest, NextResponse } from 'next/server'

import { mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { mobileInboundRoute } from '@/lib/mobile-api/inbound-route'
import { isMobileCustomerActivity } from '@/lib/mobile-api/customer-communication'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: mobileNoStoreHeaders() })
    await requireAuthorizedMobileLead(req, id)

    const db = supabaseAdmin()
    const leadResult = await db.from('leads').select('id, full_name, phone, email, property_address, city, state, zip, station, priority, assigned_agent, classification, dead_reason, source, updated_at').eq('id', id).maybeSingle()
    if (leadResult.error) throw new Error(leadResult.error.message)
    if (!leadResult.data) return NextResponse.json({ error: 'Contact not found' }, { status: 404, headers: mobileNoStoreHeaders() })
    const customerActivities: Array<{ id: string; activity_type: string; description: string | null; agent: string | null; metadata: unknown; created_at: string }> = []
    let after: { id: string; created_at: string } | undefined
    do {
      let query = db.from('lead_activities').select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', id).in('activity_type', ['call', 'missed_call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'email_sent', 'email_received', 'voicemail', 'note'])
      if (after) {
        const literal = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        query = query.or(`created_at.lt.${literal(after.created_at)},and(created_at.eq.${literal(after.created_at)},id.lt.${literal(after.id)})`)
      }
      const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
      if (result.error) throw new Error(result.error.message)
      const rows = result.data ?? []
      customerActivities.push(...rows.filter(isMobileCustomerActivity))
      if (customerActivities.length >= 100 || rows.length < 100) break
      const last = rows.at(-1)
      if (!last || (after && after.id === last.id && after.created_at === last.created_at)) throw new Error('Conversation activity cursor did not advance')
      after = last
    } while (true)

    const activities = customerActivities.slice(0, 100).map((activity) => {
      if (!['call', 'missed_call', 'voicemail'].includes(activity.activity_type)) return activity
      const metadata = activity.metadata && typeof activity.metadata === 'object' && !Array.isArray(activity.metadata)
        ? activity.metadata as Record<string, unknown> : {}
      const inboundRoute = mobileInboundRoute(metadata, activity.description)
      return inboundRoute ? { ...activity, metadata: { ...metadata, inboundRoute } } : activity
    })
    return NextResponse.json({ contact: leadResult.data, activities }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
