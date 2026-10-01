import { NextRequest, NextResponse } from 'next/server'
import { assistantActorCanReadCompanyWide } from '@/lib/assistant/auth'
import { mobileActorCanReadAssignedLead, resolveMobileScopedActor } from '@/lib/mobile-api/authorized-lead'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { buildMobileRecentCalls, type RecentCallActivityRow } from '@/lib/mobile-api/recent-calls'
import { supabaseAdmin } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

function joinedLead(value: unknown, leadId: unknown): Record<string, unknown> | null {
  // PostgREST returns a to-one object for the deployed FK; accept a single-row
  // relation array too, but never authorize an ambiguous or mismatched join.
  const lead = Array.isArray(value) ? (value.length === 1 ? value[0] : null) : value
  return lead && typeof lead === 'object' && !Array.isArray(lead)
    && typeof leadId === 'string' && (lead as Record<string, unknown>).id === leadId
    ? lead as Record<string, unknown> : null
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const email = user.email?.trim().toLowerCase() || ''
    if (!email) throw new MobileAuthError('Authenticated user has no email')
    const actor = await resolveMobileScopedActor(email)
    if (!actor) return NextResponse.json({ error: 'CRM profile not authorized' }, { status: 403, headers: mobileNoStoreHeaders() })
    const companyWide = assistantActorCanReadCompanyWide(actor)
    const db = supabaseAdmin()
    if (!companyWide) {
      if (!actor.assignmentAliases.length) return NextResponse.json({ error: 'CRM assignment unavailable' }, { status: 403, headers: mobileNoStoreHeaders() })
      // The inner lead join and assignment predicate run in the database before
      // the 500-row limit. Filtering a company-wide recent page afterwards can
      // starve an operator's own calls when the company has high call volume.
      const pages = await Promise.all(actor.assignmentAliases.map(async (alias) => {
        const result = await db.from('lead_activities')
          .select('id, lead_id, activity_type, description, agent, metadata, created_at, leads!inner(id, full_name, phone, email, property_address, city, state, zip, station, classification, assigned_agent, created_at, updated_at)')
          .in('activity_type', ['call', 'missed_call', 'voicemail'])
          .ilike('leads.assigned_agent', alias)
          .order('created_at', { ascending: false })
          .limit(500)
        if (result.error) throw new Error(result.error.message)
        return (result.data ?? []).map((row) => ({ ...row, leads: joinedLead(row.leads, row.lead_id) }))
      }))
      const scopedRows = [...new Map(pages.flat().filter((row) => row.lead_id && row.leads
        && mobileActorCanReadAssignedLead(actor, row.leads.assigned_agent)).map((row) => [row.id, row])).values()]
        .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
        .slice(0, 500)
      const leads = [...new Map(scopedRows.flatMap((row) => row.leads ? [[String(row.leads.id), row.leads] as const] : [])).values()]
      return NextResponse.json({ items: buildMobileRecentCalls(scopedRows), leads }, { headers: mobileNoStoreHeaders() })
    }
    const activityResult = await db.from('lead_activities')
      .select('id, lead_id, activity_type, description, agent, metadata, created_at')
      .in('activity_type', ['call', 'missed_call', 'voicemail'])
      .order('created_at', { ascending: false })
      .limit(500)
    if (activityResult.error) throw new Error(activityResult.error.message)

    const activityRows = (activityResult.data ?? []) as RecentCallActivityRow[]
    const leadIds = [...new Set(activityRows.flatMap((item) => item.lead_id ? [item.lead_id] : []))]
    let leads: Array<Record<string, unknown>> = []
    if (leadIds.length) {
      const leadResult = await db.from('leads')
        .select('id, full_name, phone, email, property_address, city, state, zip, station, classification, assigned_agent, created_at, updated_at')
        .in('id', leadIds)
      if (leadResult.error) {
        // An agent cannot safely see a call whose lead owner could not be checked.
        if (!companyWide) throw new Error('Recent call owner lookup failed')
        console.error('[mobile/calls/recent] linked leads unavailable', leadResult.error.message)
      } else leads = (leadResult.data ?? []) as Array<Record<string, unknown>>
    }
    const visibleLeadIds = new Set(leads.filter((lead) => mobileActorCanReadAssignedLead(actor, lead.assigned_agent))
      .map((lead) => String(lead.id)))
    const visibleRows = companyWide ? activityRows : activityRows.filter((row) => row.lead_id && visibleLeadIds.has(row.lead_id))
    const items = buildMobileRecentCalls(visibleRows)
    if (!companyWide) leads = leads.filter((lead) => visibleLeadIds.has(String(lead.id)))
    return NextResponse.json({ items, leads }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Recent calls could not be loaded.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
