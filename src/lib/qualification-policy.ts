import { supabase } from '@/lib/supabase-lazy'

export const QUALIFICATION_PILLARS = ['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE'] as const

export type QualificationPillar = (typeof QUALIFICATION_PILLARS)[number]

export type QualificationStatus = {
  qualified: boolean
  pillars: Record<QualificationPillar, boolean>
  missing: QualificationPillar[]
}

export type QualificationEvidenceRow = {
  pillar: QualificationPillar
  evidence: string | null
  status: 'needs_review' | 'verified'
}

const EMPTY_PILLARS: Record<QualificationPillar, boolean> = {
  TIMELINE: false,
  CONDITION: false,
  MOTIVATION: false,
  PRICE: false,
}

export function evaluateQualification(rows: readonly QualificationEvidenceRow[] | null | undefined): QualificationStatus {
  const pillars = { ...EMPTY_PILLARS }
  for (const row of rows ?? []) {
    if (!QUALIFICATION_PILLARS.includes(row.pillar)) continue
    pillars[row.pillar] = row.status === 'verified' && Boolean(row.evidence?.trim())
  }

  const missing = QUALIFICATION_PILLARS.filter((pillar) => !pillars[pillar])
  return { qualified: missing.length === 0, pillars, missing }
}

export async function getLeadQualificationStatus(leadId: string): Promise<QualificationStatus> {
  const statuses = await getLeadQualificationStatuses([leadId])
  return statuses.get(leadId) ?? evaluateQualification([])
}

export async function getLeadQualificationStatuses(leadIds: string[]): Promise<Map<string, QualificationStatus>> {
  const ids = [...new Set(leadIds.filter(Boolean))]
  if (ids.length === 0) return new Map()

  const { data, error } = await supabase
    .from('crm_lead_qualification_pillars')
    .select('lead_id,pillar,evidence,status')
    .in('lead_id', ids)
    .limit(ids.length * QUALIFICATION_PILLARS.length)
  if (error) throw new Error(`Qualification records unavailable: ${error.message}`)

  const rowsByLead = new Map<string, QualificationEvidenceRow[]>()
  for (const row of data ?? []) {
    if (!row.lead_id || !QUALIFICATION_PILLARS.includes(row.pillar as QualificationPillar)) continue
    const rows = rowsByLead.get(row.lead_id) ?? []
    rows.push({
      pillar: row.pillar as QualificationPillar,
      evidence: typeof row.evidence === 'string' ? row.evidence : null,
      status: row.status === 'verified' ? 'verified' : 'needs_review',
    })
    rowsByLead.set(row.lead_id, rows)
  }

  return new Map(ids.map((leadId) => [leadId, evaluateQualification(rowsByLead.get(leadId))]))
}

export function qualificationError(status: QualificationStatus): string {
  return `Qualification incomplete. Verify ${status.missing.join(', ')} before moving this record to Opportunities.`
}
