import { NextRequest, NextResponse } from 'next/server'

import { mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { assistantActorCanReadCompanyWide } from '@/lib/assistant/auth'
import { mobileActorCanReadAssignedLead } from '@/lib/mobile-api/authorized-lead'
import { MobileCommandAccessError, requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
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
    const { scopedActor } = await requireMobileCommandActor(req)
    const db = supabaseAdmin()
    const aliases = assistantActorCanReadCompanyWide(scopedActor) ? [null] : scopedActor.assignmentAliases
    if (!aliases.length) return NextResponse.json({ error: 'CRM assignment unavailable' }, { status: 403, headers: mobileNoStoreHeaders() })
    const leadPages = await Promise.all(aliases.map(async (alias) => {
      let query = db.from('leads')
        .select('id, full_name, phone, email, property_address, city, county, station, priority, assigned_agent, classification, dead_reason, source, motivation_score, arv, offer_amount, appointment_date, created_at')
        .or('station.is.null,station.not.in.(dead,closed_lost)')
        .or('classification.is.null,classification.neq.dead')
        .order('created_at', { ascending: false })
        .limit(100)
      if (alias) query = query.ilike('assigned_agent', alias)
      const { data, error } = await query
      if (error) throw new Error(error.message)
      return (data ?? []) as ConversationHubLead[]
    }))
    const leadRows = [...new Map(leadPages.flat().filter((lead) => mobileActorCanReadAssignedLead(scopedActor, lead.assigned_agent)).map((lead) => [lead.id, lead])).values()]
      .sort((left, right) => Date.parse(right.created_at ?? '') - Date.parse(left.created_at ?? ''))
      .slice(0, 100)
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

    return NextResponse.json({
      items: buildConversationHubThreads(leadRows, (activityResult.data ?? []) as ConversationHubActivity[]),
    }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : error instanceof MobileCommandAccessError ? error.status : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
