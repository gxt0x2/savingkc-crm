import { NextRequest, NextResponse } from 'next/server'

import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { buildMobileRecentCalls, type RecentCallActivityRow } from '@/lib/mobile-api/recent-calls'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const CALL_ACTIVITY_TYPES = ['call', 'missed_call', 'voicemail']

export function OPTIONS() {
  return mobileOptionsResponse()
}

export async function GET(req: NextRequest) {
  try {
    await requireMobileUser(req)
    const db = supabaseAdmin()
    const activityResult = await db
      .from('lead_activities')
      .select('id, lead_id, activity_type, description, metadata, created_at')
      .in('activity_type', CALL_ACTIVITY_TYPES)
      .order('created_at', { ascending: false })
      .limit(250)
    if (activityResult.error) throw new Error(activityResult.error.message)

    const items = buildMobileRecentCalls((activityResult.data ?? []) as RecentCallActivityRow[])
    const leadIds = [...new Set(items.flatMap((item) => item.leadId ? [item.leadId] : []))]
    let leads: unknown[] = []
    if (leadIds.length) {
      const leadResult = await db
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, state, zip, station, classification, assigned_agent, created_at, updated_at')
        .in('id', leadIds)
      if (leadResult.error) {
        console.error('[mobile/calls/recent] linked leads unavailable', leadResult.error.message)
      } else {
        leads = leadResult.data ?? []
      }
    }

    return NextResponse.json({ items, leads }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Recent calls could not be loaded.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
