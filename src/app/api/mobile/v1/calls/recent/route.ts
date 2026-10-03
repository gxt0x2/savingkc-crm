import { NextRequest, NextResponse } from 'next/server'
import { mobileActorCanReadAssignedLead, resolveMobileScopedActor } from '@/lib/mobile-api/authorized-lead'
import { MobileAuthError, mobileNoStoreHeaders, mobileOptionsResponse, requireMobileUser } from '@/lib/mobile-api/auth'
import { buildMobileRecentCalls, groupRecentCallRows, recentCallProviderIds, RECENT_CALL_PROVIDER_ID_FIELDS, type RecentCallActivityRow, visibleMobileRecentCalls } from '@/lib/mobile-api/recent-calls'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { resolveAgentTelephonyProfile } from '@/lib/telephony/agent-identity'
import { normalizePhoneToE164 } from '@/lib/phone-normalize'
import { mobileRecordingUrl } from '@/lib/mobile-api/mojo-recording'
import { twilioRecordingSid } from '@/lib/mobile-api/twilio-recording'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export function OPTIONS() { return mobileOptionsResponse() }

function postgrestLiteral(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

type CallOwnerEvidence = 'owned' | 'conflict' | 'unattributed'

function callOwnerEvidence(row: RecentCallActivityRow, identity: string, email: string, userId: string, names: string[], directLine: string | null): CallOwnerEvidence {
  const metadata = row.metadata ?? {}
  const actorEmail = typeof metadata.actor_email === 'string' ? metadata.actor_email.trim().toLowerCase() : ''
  const userEmail = typeof metadata.userEmail === 'string' ? metadata.userEmail.trim().toLowerCase() : ''
  const ownerUserId = typeof metadata.userId === 'string' ? metadata.userId.trim() : ''
  if ((actorEmail && actorEmail !== email) || (userEmail && userEmail !== email) || (ownerUserId && ownerUserId !== userId)) return 'conflict'
  const agentIdentity = typeof metadata.agent_identity === 'string' ? metadata.agent_identity.trim().toLowerCase().replace(/^client:/, '') : ''
  if (agentIdentity && agentIdentity !== identity.toLowerCase()) return 'conflict'
  if (actorEmail === email || userEmail === email || ownerUserId === userId || agentIdentity === identity.toLowerCase()) return 'owned'
  const agent = typeof row.agent === 'string' ? row.agent.trim().toLowerCase() : ''
  const allowedNames = new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean))
  if (allowedNames.has(agent)) return 'owned'
  if (agent && agent !== 'system') return 'conflict'
  if (!directLine || !['inbound', 'incoming', 'in', 'received'].includes(String(metadata.direction || '').trim().toLowerCase())) return 'unattributed'
  return normalizePhoneToE164(String(metadata.calledNumber ?? metadata.called_number ?? '')) === directLine ? 'owned' : 'unattributed'
}

export async function GET(req: NextRequest) {
  try {
    const { user } = await requireMobileUser(req)
    const email = user.email?.trim().toLowerCase() || ''
    if (!email) throw new MobileAuthError('Authenticated user has no email')
    const actor = await resolveMobileScopedActor(email)
    if (!actor) return NextResponse.json({ error: 'CRM profile not authorized' }, { status: 403, headers: mobileNoStoreHeaders() })
    const userId = typeof user.id === 'string' ? user.id : ''
    if (!userId) throw new MobileAuthError('Authenticated user identity unavailable')
    const profile = resolveAgentTelephonyProfile(email)
    const names = [...new Set([actor.fullName, profile.displayName, ...actor.assignmentAliases].filter(Boolean))]
    const directLine = profile.hasDedicatedCallerId ? profile.defaultCallerId : null
    const ownershipFilters = [
      `metadata->>actor_email.eq.${email}`,
      `metadata->>userEmail.eq.${email}`,
      `metadata->>userId.eq.${userId}`,
      `metadata->>agent_identity.eq.${profile.identity}`,
      ...names.map((name) => `agent.ilike.${postgrestLiteral(name)}`),
      ...(directLine ? [
        `metadata->>calledNumber.eq.${directLine}`,
        `metadata->>called_number.eq.${directLine}`,
      ] : []),
    ]
    const db = supabaseAdmin()
    const activityColumns = 'id, lead_id, activity_type, description, agent, metadata, created_at'
    const ownership = (row: RecentCallActivityRow) => callOwnerEvidence(row, profile.identity, email, userId, names, directLine)
    const readLeads = async (ids: string[]): Promise<Array<Record<string, unknown>>> => {
      if (!ids.length) return []
      const leadResult = await db.from('leads')
        .select('id, full_name, phone, email, property_address, city, state, zip, station, classification, assigned_agent, created_at, updated_at')
        .in('id', ids)
      if (leadResult.error) throw new Error('Linked call contacts could not be loaded.')
      return (leadResult.data ?? []) as Array<Record<string, unknown>>
    }
    const ownedRows: RecentCallActivityRow[] = []
    let leads: Array<Record<string, unknown>> = []
    const include = (item: ReturnType<typeof buildMobileRecentCalls>[number]) => visibleMobileRecentCalls([item], leads).length > 0
    let after: RecentCallActivityRow | undefined
    do {
      // One AND expression preserves ownership on every keyset page. Repeated
      // .or() calls would replace the same PostgREST query parameter.
      const filters = after
        ? `and(or(${ownershipFilters.join(',')}),or(created_at.lt.${postgrestLiteral(after.created_at)},and(created_at.eq.${postgrestLiteral(after.created_at)},id.lt.${postgrestLiteral(after.id)})))`
        : ownershipFilters.join(',')
      const result = await db.from('lead_activities').select(activityColumns)
        .in('activity_type', ['call', 'missed_call', 'voicemail'])
        .or(filters).order('created_at', { ascending: false }).order('id', { ascending: false }).limit(500)
      if (result.error) throw new Error(result.error.message)
      const page = (result.data ?? []) as RecentCallActivityRow[]
      ownedRows.push(...page.filter((row) => ownership(row) === 'owned'))
      const knownIds = new Set(leads.map((lead) => lead.id))
      leads.push(...await readLeads([...new Set(ownedRows.flatMap((row) => row.lead_id && !knownIds.has(row.lead_id) ? [row.lead_id] : []))]))
      if (buildMobileRecentCalls(ownedRows, 100, { include }).length >= 100 || page.length < 500) break
      const last = page.at(-1)
      if (!last || (after && last.id === after.id && last.created_at === after.created_at)) throw new Error('Recent call cursor did not advance.')
      after = last
    } while (true)

    // Eligibility precedes the output limit; cold-only pages cannot consume it.
    const selectedIds = new Set(buildMobileRecentCalls(ownedRows, 100, { include }).map((item) => item.id))
    const selectedRows = groupRecentCallRows(ownedRows).filter((group) => group.some((row) => selectedIds.has(row.id))).flat()
    const providerIds = [...new Set(selectedRows.flatMap(recentCallProviderIds))]
    const relatedRows: RecentCallActivityRow[] = []
    for (let offset = 0; offset < providerIds.length; offset += 20) {
      const chunk = providerIds.slice(offset, offset + 20)
      const values = chunk.map(postgrestLiteral).join(',')
      const result = await db.from('lead_activities').select(activityColumns)
        .in('activity_type', ['call', 'missed_call', 'voicemail'])
        .eq('metadata->>source', 'twilio_recording_callback')
        .or(RECENT_CALL_PROVIDER_ID_FIELDS.map((field) => `metadata->>${field}.in.(${values})`).join(','))
        .order('created_at', { ascending: false }).limit(chunk.length * 10)
      if (result.error) throw new Error('Call recording evidence could not be loaded.')
      relatedRows.push(...(result.data ?? []) as RecentCallActivityRow[])
    }
    const knownLeadIds = new Set(leads.map((lead) => lead.id))
    const callbackRows = relatedRows.filter((row) => {
      if (row.metadata?.source !== 'twilio_recording_callback' || !row.lead_id || ownership(row) === 'conflict') return false
      if (!mobileRecordingUrl(row.id, row.metadata, process.env.TWILIO_ACCOUNT_SID?.trim(), twilioRecordingSid)) return false
      const ids = new Set(recentCallProviderIds(row))
      const anchors = selectedRows.filter((anchor) => recentCallProviderIds(anchor).some((id) => ids.has(id)))
      if (!anchors.length) return false
      const anchoredLeadIds = new Set(anchors.flatMap((anchor) => anchor.lead_id ? [anchor.lead_id] : []))
      return anchoredLeadIds.size === 0 || (anchoredLeadIds.size === 1 && anchoredLeadIds.has(row.lead_id))
    })
    const additionalLeadIds = [...new Set(callbackRows.flatMap((row) => row.lead_id && !knownLeadIds.has(row.lead_id) ? [row.lead_id] : []))]
    leads = [...leads, ...await readLeads(additionalLeadIds)]
    // The call belongs to this user; asset/profile access is still determined
    // separately by the canonical linked lead and secure playback route.
    const permittedCallbacks = callbackRows.filter((row) => leads.some((lead) => lead.id === row.lead_id && mobileActorCanReadAssignedLead(actor, lead.assigned_agent)))
    const activityRows = [...new Map([...selectedRows, ...permittedCallbacks].map((row) => [row.id, row])).values()]
    const items = buildMobileRecentCalls(activityRows, 100, { include }).map((item) => ({
      ...item,
      recordingUrl: item.leadId && leads.some((lead) => lead.id === item.leadId && mobileActorCanReadAssignedLead(actor, lead.assigned_agent)) ? item.recordingUrl : null,
    }))
    const visibleLeads = leads.filter((lead) => mobileActorCanReadAssignedLead(actor, lead.assigned_agent))
    return NextResponse.json({ scope: 'mine', userId, items, leads: visibleLeads }, { headers: mobileNoStoreHeaders() })
  } catch (error) {
    const status = error instanceof MobileAuthError ? error.status : 500
    const message = error instanceof MobileAuthError ? error.message : 'Recent calls could not be loaded.'
    return NextResponse.json({ error: message }, { status, headers: mobileNoStoreHeaders() })
  }
}
