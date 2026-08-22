import { supabaseAdmin } from '@/lib/supabase/admin'

export const TASK_PROVENANCE_CLASSES = [
  'approved_workflow',
  'governed_human',
  'legacy_operator',
  'event_derived',
  'automation_unreviewed',
  'unknown',
] as const

export type TaskProvenanceClass = (typeof TASK_PROVENANCE_CLASSES)[number]
export type TaskProvenanceCount = { total: number; active: number }

export type TaskProvenanceSummary = {
  schemaVersion: 1
  department: 'acquisitions'
  generatedAt: string
  source: 'aggregate_database_census'
  total: number
  active: number
  completed: number
  classes: Record<TaskProvenanceClass, TaskProvenanceCount>
  knownSources: {
    mojo_auto_evaluate: number
    mojo_sync: number
    mojo_batch_evaluation: number
    mojo: number
    batch_briefing_v2: number
    lead_detail_task: number
    calendar: number
    website_form: number
    direct_inbound_intake: number
  }
  quality: {
    missingSource: number
    missingActor: number
    withoutEventEvidence: number
    missingDueDate: number
    unlinked: number
    possibleDuplicateRows: number
    olderThan60DaysActive: number
  }
  quarantineApplied: false
}

export class TaskProvenanceError extends Error {}

function nonNegativeInteger(value: unknown): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) throw new TaskProvenanceError('Task provenance summary is malformed.')
  return parsed
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TaskProvenanceError('Task provenance summary is malformed.')
  }
  return value as Record<string, unknown>
}

function count(value: unknown): TaskProvenanceCount {
  const row = object(value)
  return { total: nonNegativeInteger(row.total), active: nonNegativeInteger(row.active) }
}

function parseSummary(value: unknown, now: Date): TaskProvenanceSummary {
  const row = object(value)
  const classes = object(row.classes)
  const knownSources = object(row.knownSources)
  const quality = object(row.quality)
  if (row.schemaVersion !== 1 || row.department !== 'acquisitions') {
    throw new TaskProvenanceError('Task provenance summary is malformed.')
  }

  return {
    schemaVersion: 1,
    department: 'acquisitions',
    generatedAt: now.toISOString(),
    source: 'aggregate_database_census',
    total: nonNegativeInteger(row.total),
    active: nonNegativeInteger(row.active),
    completed: nonNegativeInteger(row.completed),
    classes: Object.fromEntries(TASK_PROVENANCE_CLASSES.map((key) => [
      key,
      classes[key] === undefined ? { total: 0, active: 0 } : count(classes[key]),
    ])) as Record<TaskProvenanceClass, TaskProvenanceCount>,
    knownSources: {
      mojo_auto_evaluate: nonNegativeInteger(knownSources.mojo_auto_evaluate),
      mojo_sync: nonNegativeInteger(knownSources.mojo_sync),
      mojo_batch_evaluation: nonNegativeInteger(knownSources.mojo_batch_evaluation),
      mojo: nonNegativeInteger(knownSources.mojo),
      batch_briefing_v2: nonNegativeInteger(knownSources.batch_briefing_v2),
      lead_detail_task: nonNegativeInteger(knownSources.lead_detail_task),
      calendar: nonNegativeInteger(knownSources.calendar),
      website_form: nonNegativeInteger(knownSources.website_form),
      direct_inbound_intake: nonNegativeInteger(knownSources.direct_inbound_intake),
    },
    quality: {
      missingSource: nonNegativeInteger(quality.missingSource),
      missingActor: nonNegativeInteger(quality.missingActor),
      withoutEventEvidence: nonNegativeInteger(quality.withoutEventEvidence),
      missingDueDate: nonNegativeInteger(quality.missingDueDate),
      unlinked: nonNegativeInteger(quality.unlinked),
      possibleDuplicateRows: nonNegativeInteger(quality.possibleDuplicateRows),
      olderThan60DaysActive: nonNegativeInteger(quality.olderThan60DaysActive),
    },
    quarantineApplied: false,
  }
}

export async function getTaskProvenanceSummary(now = new Date()): Promise<TaskProvenanceSummary> {
  const { data, error } = await supabaseAdmin().rpc('task_provenance_summary_v1', {
    p_department: 'acquisitions',
  })
  if (error) throw new TaskProvenanceError('Task provenance census is unavailable.')
  return parseSummary(data, now)
}
