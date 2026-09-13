import { supabase } from '@/lib/supabase-lazy'
import {
  QUALIFICATION_PILLARS,
  evaluateQualification,
  type QualificationEvidenceRow,
  type QualificationPillar,
  type QualificationStatus,
} from './qualification-policy-core'

export {
  QUALIFICATION_PILLARS,
  evaluateQualification,
  qualificationError,
  type QualificationEvidenceRow,
  type QualificationPillar,
  type QualificationStatus,
} from './qualification-policy-core'

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
