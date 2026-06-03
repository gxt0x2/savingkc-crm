import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase-lazy'

// GET /api/heirs?lead_id=<uuid>
//
// Returns heirs for a lead by joining its prospects → prospect_phones, grouped
// by (contact_name, relationship). A "heir" here is any prospect_phone with a
// relationship that isn't 'owner' — daughter, son, spouse, sister, etc.
export async function GET(req: Request) {
  const url = new URL(req.url)
  const leadId = url.searchParams.get('lead_id')

  if (!leadId) {
    return NextResponse.json({ error: 'lead_id required' }, { status: 400 })
  }

  // Step 1: find all prospect_ids linked to this lead.
  const { data: prospects, error: pErr } = await supabase
    .from('prospects')
    .select('id, owner_1, is_deceased, is_skip_traced, county, situs_address, delinquent_years_category')
    .eq('lead_id', leadId)

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

  // Step 2: pull every phone for those prospects. Owner phones are kept
  // separately so the UI can still show the deceased owner's own number if
  // useful, but heir rows only include non-owner relationships.
  const { data: phones, error: phErr } = await supabase
    .from('prospect_phones')
    .select('id, prospect_id, phone, phone_type, phone_connected, contact_name, relationship, contact_address, attempted, last_disposition, last_attempt_at, is_verified_contact, verified_at, verified_by, created_at')
    .in('prospect_id', prospectIds)
    .order('created_at', { ascending: true })

  if (phErr) {
    return NextResponse.json({ error: phErr.message }, { status: 500 })
  }

  type PhoneRow = NonNullable<typeof phones>[number]
  const heirPhones = (phones ?? []).filter(
    (p: PhoneRow) => (p.relationship ?? '').toLowerCase() !== 'owner',
  )

  // Step 3: group by (contact_name || unknown-N, relationship) so that
  // multiple phones for the same relative roll up into one heir card.
  const groups = new Map<string, {
    key: string
    contact_name: string
    relationship: string
    address: string | null
    phones: PhoneRow[]
  }>()

  heirPhones.forEach((p: PhoneRow, idx: number) => {
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
    .map((g) => ({
      key: g.key,
      contact_name: g.contact_name,
      relationship: g.relationship,
      address: g.address,
      unattempted_count: g.phones.filter((p) => !p.attempted).length,
      phones: g.phones.map((p) => ({
        id: p.id,
        number: p.phone,
        type: p.phone_type,
        connected: p.phone_connected,
        attempted: p.attempted ?? false,
        last_disposition: p.last_disposition,
        last_attempt_at: p.last_attempt_at,
        is_verified_contact: (p as { is_verified_contact?: boolean }).is_verified_contact ?? false,
        verified_at: (p as { verified_at?: string | null }).verified_at ?? null,
        verified_by: (p as { verified_by?: string | null }).verified_by ?? null,
      })),
    }))
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
