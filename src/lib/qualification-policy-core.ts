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

export function qualificationError(status: QualificationStatus): string {
  return `Qualification incomplete. Verify ${status.missing.join(', ')} before moving this record to Opportunities.`
}

/** Current Lead row clock used as a concurrency token. Not a new CRM column. */
export function leadRevisionFromUpdatedAt(updatedAt: Date | string | null | undefined) {
  const time = updatedAt ? new Date(updatedAt).getTime() : Number.NaN
  return Number.isFinite(time) && time >= 0 ? time : null
}
