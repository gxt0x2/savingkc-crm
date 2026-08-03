import type { ManifestV2 } from '@/lib/manifest-builder'
import { supabase } from '@/lib/supabase-lazy'

export const QUALIFICATION_PILLARS = ['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE'] as const

export type QualificationPillar = (typeof QUALIFICATION_PILLARS)[number]

export type QualificationStatus = {
  qualified: boolean
  pillars: Record<QualificationPillar, boolean>
  missing: QualificationPillar[]
}

type QualificationInput = {
  lead?: Record<string, unknown> | null
  manifest?: ManifestV2 | Record<string, unknown> | null
  activityMetadata?: Array<Record<string, unknown> | null> | null
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function hasEvidence(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string') return false
  const normalized = value.trim().toLowerCase()
  return Boolean(normalized) && !['false', 'unknown', 'none', 'not captured', 'n/a'].includes(normalized)
}

function anyEvidence(...values: unknown[]): boolean {
  return values.some(hasEvidence)
}

export function evaluateQualification(input: QualificationInput): QualificationStatus {
  const lead = record(input.lead)
  const leadPillars = record(lead.four_pillars)
  const leadMetadata = record(lead.metadata)
  const manifest = record(input.manifest)
  const situation = record(manifest.situation)
  const timeline = record(situation.timeline)
  const motivation = record(situation.motivation)
  const priceExpectations = record(situation.priceExpectations)
  const property = record(manifest.property)
  const condition = record(property.condition)
  const financials = record(manifest.financials)
  const deal = record(manifest.deal)

  const activityPillars = (input.activityMetadata ?? []).reduce<Record<string, unknown>>(
    (combined, item) => ({ ...combined, ...record(record(item).pillars), ...record(item) }),
    {},
  )

  const explicit = (pillar: QualificationPillar) => anyEvidence(
    leadPillars[pillar],
    leadPillars[pillar.toLowerCase()],
    leadMetadata[pillar],
    leadMetadata[pillar.toLowerCase()],
    activityPillars[pillar],
    activityPillars[pillar.toLowerCase()],
  )

  const pillars: Record<QualificationPillar, boolean> = {
    TIMELINE: explicit('TIMELINE') || anyEvidence(
      timeline.preferredClosing,
      timeline.targetCloseDate,
      timeline.sellerDeadline,
      timeline.urgency,
      timeline.flexibility,
    ),
    CONDITION: explicit('CONDITION') || anyEvidence(
      condition.overall,
      condition.notes,
      property.occupancy,
      property.vacant,
    ),
    MOTIVATION: explicit('MOTIVATION') || anyEvidence(
      motivation.primary,
      motivation.score,
      motivation.urgencyLevel,
      Array.isArray(motivation.signals) && motivation.signals.length > 0,
    ),
    PRICE: explicit('PRICE') || anyEvidence(
      priceExpectations.askingPrice,
      priceExpectations.minimumAcceptable,
      priceExpectations.sellerAsking,
      priceExpectations.sellerFloor,
      priceExpectations.priceFlexibility,
      priceExpectations.priceAnchor,
      financials.asking_price,
      deal.offerRange,
    ),
  }

  const missing = QUALIFICATION_PILLARS.filter((pillar) => !pillars[pillar])
  return { qualified: missing.length === 0, pillars, missing }
}

export async function getLeadQualificationStatus(leadId: string): Promise<QualificationStatus> {
  const statuses = await getLeadQualificationStatuses([leadId])
  return statuses.get(leadId) ?? {
    qualified: false,
    pillars: { TIMELINE: false, CONDITION: false, MOTIVATION: false, PRICE: false },
    missing: [...QUALIFICATION_PILLARS],
  }
}

export async function getLeadQualificationStatuses(leadIds: string[]): Promise<Map<string, QualificationStatus>> {
  const ids = [...new Set(leadIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const [leadResult, manifestResult, activitiesResult] = await Promise.all([
    supabase.from('leads').select('*').in('id', ids),
    supabase
      .from('manifests')
      .select('lead_id, manifest, created_at')
      .in('lead_id', ids)
      .order('created_at', { ascending: false })
      .limit(Math.max(ids.length * 3, 20)),
    supabase
      .from('lead_activities')
      .select('lead_id, metadata, created_at')
      .in('lead_id', ids)
      .in('activity_type', ['pillar_data', 'qualification'])
      .order('created_at', { ascending: false })
      .limit(Math.max(ids.length * 20, 100)),
  ])

  const manifests = new Map<string, ManifestV2 | Record<string, unknown>>()
  for (const row of manifestResult.data ?? []) {
    if (row.lead_id && !manifests.has(row.lead_id)) {
      manifests.set(row.lead_id, row.manifest as ManifestV2 | Record<string, unknown>)
    }
  }

  const activityMetadata = new Map<string, Array<Record<string, unknown>>>()
  for (const row of activitiesResult.data ?? []) {
    if (!row.lead_id) continue
    const items = activityMetadata.get(row.lead_id) ?? []
    items.push(record(row.metadata))
    activityMetadata.set(row.lead_id, items)
  }

  const leads = new Map(
    (leadResult.data ?? []).map((lead) => [lead.id as string, lead as Record<string, unknown>]),
  )
  return new Map(ids.map((leadId) => [
    leadId,
    evaluateQualification({
      lead: leads.get(leadId),
      manifest: manifests.get(leadId),
      activityMetadata: activityMetadata.get(leadId),
    }),
  ]))
}

export function qualificationError(status: QualificationStatus): string {
  return `Qualification incomplete. Capture ${status.missing.join(', ')} before moving this record to Opportunities.`
}
