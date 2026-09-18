import { NextRequest, NextResponse } from 'next/server'

import { requireMobileUser, mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import {
  buildConversationHubThreads,
  type ConversationHubActivity,
  type ConversationHubLead,
} from '@/lib/operating-model/conversation-hub'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const ACTIVITY_TYPES = ['call', 'sms', 'sms_sent', 'sms_received', 'sms_inbound', 'sms_outbound', 'email', 'voicemail', 'task', 'status_change']

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const db = supabaseAdmin()
    const { data: leads, error: leadsError } = await db
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, county, station, priority, assigned_agent, classification, dead_reason, source, motivation_score, arv, offer_amount, appointment_date, is_favorite, created_at')
      .or('station.is.null,station.not.in.(dead,closed_lost)')
      .or('classification.is.null,classification.neq.dead')
      .order('created_at', { ascending: false })
      .limit(100)

    if (leadsError) throw new Error(leadsError.message)
    const leadRows = (leads ?? []) as ConversationHubLead[]
    if (leadRows.length === 0) return NextResponse.json({ items: [] }, { headers: mobileNoStoreHeaders() })

    const ids = leadRows.map((lead) => lead.id)
    const activityResult = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('lead_id', ids)
      .in('activity_type', ACTIVITY_TYPES)
      .order('created_at', { ascending: false })
      .limit(3000)
    if (activityResult.error) throw new Error(activityResult.error.message)

    const activities = (activityResult.data ?? []) as ConversationHubActivity[]
    const pinnedIds = new Set(
      Array.isArray(user.app_metadata?.pinned_chat_ids)
        ? user.app_metadata.pinned_chat_ids.filter((value): value is string => typeof value === 'string')
        : [],
    )

    return NextResponse.json({
      items: buildConversationHubThreads(leadRows, activities).map((item) => ({
        ...item,
        pinned: pinnedIds.has(item.id),
      })),
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
