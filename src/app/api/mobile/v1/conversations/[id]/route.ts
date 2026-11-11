import { NextRequest, NextResponse } from 'next/server'

import { assistantActorCanReadCompanyWide } from '@/lib/assistant/auth'
import { formatPhone } from '@/lib/format'
import { mobileNoStoreHeaders, MobileAuthError, mobileOptionsResponse } from '@/lib/mobile-api/auth'
import { MobileLeadAccessError, requireAuthorizedMobileLead } from '@/lib/mobile-api/authorized-lead'
import { normalizeMobileCallActivities } from '@/lib/mobile-api/activity-calls'
import { attachLeadEmailBodies, type LeadEmailBodyReader } from '@/lib/mobile-api/email-activity-bodies'
import { isMobileCustomerActivity } from '@/lib/mobile-api/customer-communication'
import { MobileCommandAccessError, requireMobileCommandActor } from '@/lib/mobile-api/mobile-command-access'
import {
  activityBelongsToPhoneThread,
  MOBILE_CONVERSATION_ACTIVITY_TYPES,
  unmatchedPhoneFromThreadId,
} from '@/lib/mobile-api/phone-thread'
import { attachManualEmailConsent } from '@/lib/server/manual-email-consent'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() {
  return mobileOptionsResponse()
}

type ConversationActivity = { id: string; activity_type: string; description: string | null; agent: string | null; metadata: unknown; created_at: string }

async function pageCustomerActivities(
  loadPage: (after?: { id: string; created_at: string }) => Promise<ConversationActivity[]>,
  include: (activity: ConversationActivity) => boolean,
): Promise<ConversationActivity[]> {
  const customerActivities: ConversationActivity[] = []
  let after: { id: string; created_at: string } | undefined
  do {
    const rows = await loadPage(after)
    customerActivities.push(...rows.filter(include))
    if (customerActivities.length >= 100 || rows.length < 100) break
    const last = rows.at(-1)
    if (!last || (after && after.id === last.id && after.created_at === last.created_at)) throw new Error('Conversation activity cursor did not advance')
    after = last
  } while (true)
  return customerActivities.slice(0, 100)
}

async function readUnmatchedPhoneConversation(req: NextRequest, phone: string) {
  const { scopedActor } = await requireMobileCommandActor(req)
  if (!assistantActorCanReadCompanyWide(scopedActor)) {
    throw new MobileLeadAccessError('This conversation is outside your authorized scope', 403)
  }
  const db = supabaseAdmin()
  const activities = normalizeMobileCallActivities(await pageCustomerActivities(async (after) => {
    let query = db.from('lead_activities').select('id, activity_type, description, agent, metadata, created_at')
      .is('lead_id', null)
      .in('activity_type', [...MOBILE_CONVERSATION_ACTIVITY_TYPES])
      .or(`metadata->>from.eq."${phone}",metadata->>to.eq."${phone}"`)
    if (after) {
      const literal = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
      query = query.or(`created_at.lt.${literal(after.created_at)},and(created_at.eq.${literal(after.created_at)},id.lt.${literal(after.id)})`)
    }
    const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
    if (result.error) throw new Error(result.error.message)
    return result.data ?? []
  }, (activity) => activityBelongsToPhoneThread(activity, phone)))
  return NextResponse.json({
    contact: {
      id: `unmatched:${phone}`,
      full_name: formatPhone(phone) || phone,
      phone,
      email: null,
      property_address: null,
      city: null,
      state: null,
      zip: null,
      station: 'unmatched',
      priority: 'normal',
      assigned_agent: null,
      classification: null,
      dead_reason: null,
      source: 'unmatched_activity',
      updated_at: activities[0]?.created_at ?? null,
    },
    activities,
  }, { headers: mobileNoStoreHeaders() })
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400, headers: mobileNoStoreHeaders() })
    const phone = unmatchedPhoneFromThreadId(id)
    if (phone) return await readUnmatchedPhoneConversation(req, phone)
    await requireAuthorizedMobileLead(req, id)

    const db = supabaseAdmin()
    const leadResult = await db.from('leads').select('id, full_name, phone, email, property_address, city, state, zip, station, priority, assigned_agent, classification, dead_reason, source, updated_at').eq('id', id).maybeSingle()
    if (leadResult.error) throw new Error(leadResult.error.message)
    if (!leadResult.data) return NextResponse.json({ error: 'Contact not found' }, { status: 404, headers: mobileNoStoreHeaders() })
    const customerActivities = await pageCustomerActivities(async (after) => {
      let query = db.from('lead_activities').select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', id).in('activity_type', [...MOBILE_CONVERSATION_ACTIVITY_TYPES])
      if (after) {
        const literal = (value: string) => `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
        query = query.or(`created_at.lt.${literal(after.created_at)},and(created_at.eq.${literal(after.created_at)},id.lt.${literal(after.id)})`)
      }
      const result = await query.order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100)
      if (result.error) throw new Error(result.error.message)
      return result.data ?? []
    }, isMobileCustomerActivity)

    const activities = await attachLeadEmailBodies(db as unknown as LeadEmailBodyReader, id, normalizeMobileCallActivities(customerActivities))
    const [contact] = await attachManualEmailConsent([leadResult.data])
    return NextResponse.json({ contact, activities }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError || error instanceof MobileLeadAccessError || error instanceof MobileCommandAccessError
      ? error.status
      : 500
    const message = error instanceof Error ? error.message : 'Internal error'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
