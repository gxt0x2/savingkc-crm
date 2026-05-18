export const dynamic = 'force-dynamic'
export const maxDuration = 60

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase/admin'
import { ACQUISITION_STAGES, normalizeDealStage, type DealStage } from '@/types/pipeline'

/**
 * GET /api/contacts
 *
 * Returns one row per active lead with the fields the Contacts
 * smart list needs: name, address, phone, next activity, tags, station,
 * composite score. Parked and archived leads are excluded here. Single endpoint — the page filters by station tab on
 * the client.
 *
 * Auth: session (the page is auth-gated).
 */

export interface ContactRow {
  id: string
  fullName: string | null
  phone: string | null
  address: string | null
  city: string | null
  station: DealStage
  score: number
  isFavorite: boolean
  nextActivity: {
    when: string | null
    label: string
    kind: 'appointment' | 'recommended' | null
  } | null
  tags: string[]
  lastContactAt: string | null
  updatedAt: string | null
}

interface ManifestPayload {
  pipeline?: {
    appointment?: {
      status?: string
      scheduledAt?: string | null
    }
  }
  ariIntelligence?: {
    recommendedActions?: Array<{ action?: string; dateTime?: string; reason?: string }>
  }
  flags?: {
    opportunityFlags?: string[]
    redFlags?: string[]
  }
  situation?: {
    type?: string[]
    timeline?: {
      lifeEventType?: string
    }
  }
  communications?: {
    lastSellerContactDate?: string
    lastInboundDate?: string
  }
}

const ACTIVE_CONTACT_STAGES = new Set<DealStage>([...ACQUISITION_STAGES, 'under_contract'])

function getActiveContactStation(station: string | null | undefined): DealStage | null {
  const normalized = normalizeDealStage(station) ?? 'new'
  return ACTIVE_CONTACT_STAGES.has(normalized) ? normalized : null
}

function pickNextActivity(m: ManifestPayload): ContactRow['nextActivity'] {
  const appt = m.pipeline?.appointment
  if (appt && appt.status && ['scheduled', 'confirmed', 'reconfirmed'].includes(appt.status.toLowerCase())) {
    const rawAt = typeof appt.scheduledAt === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(appt.scheduledAt)
      ? appt.scheduledAt
      : null
    if (rawAt) {
      return { kind: 'appointment', when: rawAt, label: 'Appointment' }
    }
  }
  const rec = m.ariIntelligence?.recommendedActions?.[0]
  if (rec?.action) {
    return { kind: 'recommended', when: rec.dateTime ?? null, label: rec.action }
  }
  return null
}

function pickTags(m: ManifestPayload): string[] {
  const tags = new Set<string>()
  for (const f of m.flags?.opportunityFlags ?? []) {
    if (typeof f === 'string' && f.trim()) tags.add(f.trim())
  }
  for (const t of m.situation?.type ?? []) {
    if (typeof t === 'string' && t.trim()) tags.add(t.trim())
  }
  const life = m.situation?.timeline?.lifeEventType
  if (life && life !== 'other') tags.add(life)
  return [...tags].slice(0, 6)
}

export async function GET() {
  const db = supabaseAdmin()

  const { data: leads, error: leadsErr } = await db
    .from('leads')
    .select('id, full_name, phone, station, property_address, city, updated_at, is_parked, is_favorite')
    .eq('is_parked', false)
    .order('updated_at', { ascending: false })

  if (leadsErr) return NextResponse.json({ error: leadsErr.message }, { status: 500 })
  const rows = leads ?? []
  const activeRows = rows
    .map((lead) => ({ lead, station: getActiveContactStation(lead.station) }))
    .filter((row): row is { lead: typeof rows[number]; station: DealStage } => row.station !== null)

  if (activeRows.length === 0) return NextResponse.json({ items: [] })

  const leadIds = activeRows.map(({ lead }) => lead.id)

  const [{ data: manifests }, { data: scores }] = await Promise.all([
    db
      .from('manifests')
      .select('lead_id, manifest, created_at')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: false }),
    db
      .from('hot_opportunities_cache')
      .select('lead_id, composite_score')
      .in('lead_id', leadIds),
  ])

  const latestManifest = new Map<string, ManifestPayload>()
  for (const m of manifests ?? []) {
    if (!latestManifest.has(m.lead_id)) {
      latestManifest.set(m.lead_id, (m.manifest ?? {}) as ManifestPayload)
    }
  }

  const scoreByLead = new Map<string, number>()
  for (const s of scores ?? []) {
    scoreByLead.set(s.lead_id, Number(s.composite_score ?? 0))
  }

  const items: ContactRow[] = []
  for (const { lead, station } of activeRows) {
    const manifest = latestManifest.get(lead.id) ?? {}
    const lastContactAt =
      manifest.communications?.lastSellerContactDate ??
      manifest.communications?.lastInboundDate ??
      null

    items.push({
      id: lead.id,
      fullName: lead.full_name,
      phone: lead.phone,
      address: lead.property_address,
      city: lead.city,
      station,
      score: scoreByLead.get(lead.id) ?? 0,
      isFavorite: Boolean((lead as { is_favorite?: boolean | null }).is_favorite),
      nextActivity: pickNextActivity(manifest),
      tags: pickTags(manifest),
      lastContactAt,
      updatedAt: lead.updated_at,
    })
  }

  return NextResponse.json({ items })
}
