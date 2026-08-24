import { NextResponse } from 'next/server'
import { requireAuthenticatedUser } from '@/lib/api/require-authenticated-user'
import { supabase } from '@/lib/supabase-lazy'
import { isMissingColumnError } from '@/lib/schema-compat'
import {
  buildCampaignCallContactGroups,
  type CampaignCallContactHistory,
  type CampaignCallContactSnapshot,
} from '@/lib/server/prospecting-campaign-call-contacts'

interface HeirPhoneRow {
  id: string
  prospect_id: string
  phone: string | null
  phone_type: string | null
  phone_connected: string | boolean | null
  contact_name: string | null
  relationship: string | null
  contact_address: string | null
  attempted: boolean | null
  last_disposition: string | null
  last_attempt_at: string | null
  created_at: string
  // Added by 20260602_dialer_redesign.sql — optional until that migration runs.
  is_verified_contact?: boolean | null
  verified_at?: string | null
  verified_by?: string | null
}

/** Phone digits for comparison — strips formatting and a US country code. */
function phoneKey(phone: string | null): string {
  const digits = (phone ?? '').replace(/\D/g, '')
  return digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
}

/** Rank a row so dedupe keeps the most useful copy of a repeated number. */
function phoneSignal(p: HeirPhoneRow): number {
  if (p.is_verified_contact) return 3
  if (p.last_disposition) return 2
  if (p.attempted) return 1
  return 0
}

/**
 * Collapse repeated numbers within one heir. Skip-trace often returns the same
 * number more than once (e.g. listed under multiple "types"), and the sync
 * stores each row, so without this the same number shows as several pills and
 * pads the dial queue. Keeps the copy with the most call history, in first-seen
 * (created_at) order.
 */
function dedupePhones(phones: HeirPhoneRow[]): HeirPhoneRow[] {
  const byNumber = new Map<string, HeirPhoneRow>()
  const order: string[] = []
  for (const p of phones) {
    const key = phoneKey(p.phone)
    if (!key) continue
    const existing = byNumber.get(key)
    if (!existing) {
      byNumber.set(key, p)
      order.push(key)
    } else if (phoneSignal(p) > phoneSignal(existing)) {
      byNumber.set(key, p)
    }
  }
  return order.map((k) => byNumber.get(k)!)
}

// GET /api/heirs?lead_id=<uuid> or ?prospect_id=<uuid>
//
// Returns every associated person for a Lead or source Prospect by joining its
// prospects → prospect_phones and grouping by (contact_name, relationship).
// Owner-labeled rows remain visible: the reviewed campaign contract promises
// that no associated phone silently disappears from the calling floor.
export async function GET(req: Request) {
  const unauthorized = await requireAuthenticatedUser()
  if (unauthorized) return unauthorized

  const url = new URL(req.url)
  const leadId = url.searchParams.get('lead_id')
  const prospectId = url.searchParams.get('prospect_id')
  const campaignMemberId = url.searchParams.get('campaign_member_id')

  if ((!leadId && !prospectId) || (leadId && prospectId)) {
    return NextResponse.json({ error: 'Provide exactly one lead_id or prospect_id' }, { status: 400 })
  }


  if (campaignMemberId) {
    const { data: member, error: memberError } = await supabase
      .from('prospecting_campaign_members')
      .select('id,subject_kind,lead_id,prospect_id')
      .eq('id', campaignMemberId)
      .maybeSingle<{
        id: string
        subject_kind: 'lead' | 'prospect'
        lead_id: string | null
        prospect_id: string | null
      }>()
    if (memberError) return NextResponse.json({ error: 'Campaign audience is unavailable' }, { status: 500 })
    if (!member || member.lead_id !== leadId || member.prospect_id !== prospectId) {
      return NextResponse.json({ error: 'Campaign member does not match this calling record' }, { status: 409 })
    }
  }

  // Step 1: find all prospect_ids linked to this lead.
  let prospectQuery = supabase
    .from('prospects')
    .select('id, owner_1, is_deceased, is_skip_traced, county, situs_address, delinquent_years_category')
  prospectQuery = leadId ? prospectQuery.eq('lead_id', leadId) : prospectQuery.eq('id', prospectId!)
  const { data: prospects, error: pErr } = await prospectQuery

  if (pErr) {
    return NextResponse.json({ error: pErr.message }, { status: 500 })
  }

  if (!prospects || prospects.length === 0) {
    return NextResponse.json({
      heirs: [],
      prospect: null,
      last_skip_traced_at: null,
    })
  }

  const prospectIds = prospects.map((p) => p.id)

  if (campaignMemberId) {
    const { data: contacts, error: contactsError } = await supabase
      .from('prospecting_campaign_member_contacts')
      .select('id,source_kind,prospect_id,prospect_phone_id,phone_snapshot,contact_name,relationship,phone_type,status,suppression_reason,enrolled_at')
      .eq('member_id', campaignMemberId)
      .neq('status', 'removed')
      .order('enrolled_at', { ascending: true })
      .limit(500)
    if (contactsError) return NextResponse.json({ error: 'Reviewed campaign contacts are unavailable' }, { status: 500 })

    const contactRows = (contacts ?? []) as CampaignCallContactSnapshot[]
    const phoneIds = contactRows.flatMap((contact) => contact.prospect_phone_id ? [contact.prospect_phone_id] : [])
    const historyByPhone = new Map<string, CampaignCallContactHistory>()
    if (phoneIds.length > 0) {
      const readHistory = (columns: string) => supabase
        .from('prospect_phones')
        .select(columns)
        .in('id', phoneIds)
        .limit(phoneIds.length)
      let historyResult = await readHistory('id,attempted,last_disposition,last_attempt_at,is_verified_contact,verified_at,verified_by')
      if (historyResult.error && isMissingColumnError(historyResult.error)) {
        historyResult = await readHistory('id,attempted,last_disposition,last_attempt_at')
      }
      if (historyResult.error) {
        return NextResponse.json({ error: 'Campaign contact history is unavailable' }, { status: 500 })
      }
      for (const row of (historyResult.data ?? []) as unknown as Array<CampaignCallContactHistory & { id: string }>) {
        historyByPhone.set(row.id, row)
      }
    }
    const heirs = buildCampaignCallContactGroups(contactRows, historyByPhone)

    return NextResponse.json({
      heirs,
      prospect: prospects[0],
      is_deceased: prospects.some((p) => p.is_deceased),
      is_skip_traced: prospects.some((p) => p.is_skip_traced),
      last_skip_traced_at: contactRows.at(-1)?.enrolled_at ?? null,
      source: 'campaign_snapshot',
    })
  }

  // Step 2: pull every associated phone for those prospects.
  // The verify columns come from 20260602_dialer_redesign.sql. If that migration
  // hasn't reached this environment yet, retry without them so the heirs list
  // still renders (verified flags just default to false/null) instead of 500ing.
  const BASE_PHONE_COLS = 'id, prospect_id, phone, phone_type, phone_connected, contact_name, relationship, contact_address, attempted, last_disposition, last_attempt_at, created_at'
  const FULL_PHONE_COLS = `${BASE_PHONE_COLS}, is_verified_contact, verified_at, verified_by`
  const queryPhones = (cols: string) =>
    supabase
      .from('prospect_phones')
      .select(cols)
      .in('prospect_id', prospectIds)
      .order('created_at', { ascending: true })

  let phRes = await queryPhones(FULL_PHONE_COLS)
  if (phRes.error && isMissingColumnError(phRes.error)) {
    phRes = await queryPhones(BASE_PHONE_COLS)
  }
  if (phRes.error) {
    return NextResponse.json({ error: phRes.error.message }, { status: 500 })
  }
  const phones = (phRes.data ?? []) as unknown as HeirPhoneRow[]

  // Step 3: group by (contact_name || unknown-N, relationship) so that
  // multiple phones for the same relative roll up into one heir card.
  const groups = new Map<string, {
    key: string
    contact_name: string
    relationship: string
    address: string | null
    phones: HeirPhoneRow[]
  }>()

  phones.forEach((p, idx) => {
    const name = (p.contact_name ?? '').trim() || `Unknown ${idx + 1}`
    const relation = (p.relationship ?? '').trim() || 'relative'
    const key = `${name}::${relation}`
    const existing = groups.get(key)
    if (existing) {
      existing.phones.push(p)
      if (!existing.address && p.contact_address) existing.address = p.contact_address
    } else {
      groups.set(key, { key, contact_name: name, relationship: relation, address: p.contact_address ?? null, phones: [p] })
    }
  })

  // Heirs with at least one unattempted phone go first, then by name.
  const heirs = Array.from(groups.values())
    .map((g) => {
      const phones = dedupePhones(g.phones)
      return {
        key: g.key,
        contact_name: g.contact_name,
        relationship: g.relationship,
        address: g.address,
        unattempted_count: phones.filter((p) => !p.attempted).length,
        phones: phones.map((p) => ({
          id: p.id,
          snapshot_id: null,
          prospect_id: p.prospect_id,
          prospect_phone_id: p.id,
          number: p.phone,
          type: p.phone_type,
          connected: p.phone_connected,
          status: 'ready',
          suppression_reason: null,
          attempted: p.attempted ?? false,
          last_disposition: p.last_disposition,
          last_attempt_at: p.last_attempt_at,
          is_verified_contact: p.is_verified_contact ?? false,
          verified_at: p.verified_at ?? null,
          verified_by: p.verified_by ?? null,
        })),
      }
    })
    .sort((a, b) => {
      if (a.unattempted_count !== b.unattempted_count) {
        return b.unattempted_count - a.unattempted_count
      }
      return a.contact_name.localeCompare(b.contact_name)
    })

  // Latest traced_at proxy — the most recent prospect_phones row for this lead.
  const lastSkipTracedAt = phones?.length
    ? phones.map((p) => p.created_at).sort().slice(-1)[0] ?? null
    : null

  return NextResponse.json({
    heirs,
    prospect: prospects[0], // primary prospect — used for property context
    is_deceased: prospects.some((p) => p.is_deceased),
    is_skip_traced: prospects.some((p) => p.is_skip_traced),
    last_skip_traced_at: lastSkipTracedAt,
  })
}
