import { MY_DAY_TIME_ZONE, type MyDayDateRange } from '@/lib/my-day-range'

interface StageEntrySource {
  range: Pick<MyDayDateRange, 'from' | 'to'>
  leads: Array<{ id: string; station: string | null; created_at: string }>
  activities: Array<{
    lead_id: string | null
    activity_type: string
    metadata: Record<string, unknown> | null
    created_at: string
  }>
  appointments: Array<{ lead_id: string | null; created_at: string }>
  lifecycleEvents?: MyDayLifecycleEvent[]
  leadsWithStageHistory?: string[]
}

export interface MyDayLifecycleEvent {
  id: string
  lead_id: string | null
  from_stage: string | null
  to_stage: string | null
  occurred_at: string
}

const STAGE_RANK: Record<string, number> = {
  new: 0,
  contacted: 1,
  qualifying: 1,
  qualified: 2,
  appointment_set: 3,
  appt_set: 3,
  offer_made: 4,
  negotiations: 4,
  under_contract: 5,
  contract_signed: 5,
  closed_won: 6,
  closed: 6,
}

const DATE_KEY = new Intl.DateTimeFormat('en-CA', {
  timeZone: MY_DAY_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stageRank(stage: string | null | undefined): number {
  const key = text(stage).toLowerCase()
  return key ? STAGE_RANK[key] ?? -1 : -1
}

function metadataRecord(metadata: unknown): Record<string, unknown> | null {
  return metadata && typeof metadata === 'object' && !Array.isArray(metadata)
    ? metadata as Record<string, unknown>
    : null
}

/** A status_change counts only when it records the stage the lead moved to. */
export function recordedStageMove(metadata: unknown): { fromStage: string; toStage: string } | null {
  const record = metadataRecord(metadata)
  const toStage = text(record?.new_station) || text(record?.to_stage)
  if (!toStage) return null
  return {
    fromStage: text(record?.old_station) || text(record?.from_stage),
    toStage,
  }
}

function movedUpInto(fromStage: string, toStage: string, threshold: number): boolean {
  const toRank = stageRank(toStage)
  const fromRank = fromStage ? stageRank(fromStage) : -1
  return toRank >= threshold && fromRank < threshold && toRank > fromRank
}

function inRange(value: string | null | undefined, range: Pick<MyDayDateRange, 'from' | 'to'>): boolean {
  if (!value) return false
  const parsed = new Date(value)
  if (!Number.isFinite(parsed.getTime())) return false
  const key = DATE_KEY.format(parsed)
  return key >= range.from && key <= range.to
}

function keepEarliest(entries: Map<string, string>, leadId: string, at: string) {
  const current = entries.get(leadId)
  if (!current || new Date(at).getTime() < new Date(current).getTime()) entries.set(leadId, at)
}

export function stageHistoryLeadIds(
  activities: Array<{ lead_id: string | null; metadata: unknown }>,
  events: Array<{ lead_id: string | null; to_stage: string | null }>,
): string[] {
  const ids = new Set<string>()
  for (const activity of activities) {
    if (activity.lead_id && recordedStageMove(activity.metadata)) ids.add(activity.lead_id)
  }
  for (const event of events) {
    if (event.lead_id && text(event.to_stage)) ids.add(event.lead_id)
  }
  return [...ids]
}

/**
 * Stage metrics count a lead on the Central day it actually entered the rank.
 * Appointment rows created that day also count, once per lead. Leads that
 * predate stage history can fall back to created_at. updated_at never counts.
 */
export function stageEntries(
  input: StageEntrySource,
  threshold: number,
  range: Pick<MyDayDateRange, 'from' | 'to'> = input.range,
): Map<string, string> {
  const entries = new Map<string, string>()
  const history = new Set(input.leadsWithStageHistory ?? [])

  for (const activity of input.activities) {
    if (!activity.lead_id || activity.activity_type.toLowerCase() !== 'status_change') continue
    const move = recordedStageMove(activity.metadata)
    if (!move) continue
    history.add(activity.lead_id)
    if (inRange(activity.created_at, range) && movedUpInto(move.fromStage, move.toStage, threshold)) {
      keepEarliest(entries, activity.lead_id, activity.created_at)
    }
  }

  for (const event of input.lifecycleEvents ?? []) {
    const toStage = text(event.to_stage)
    if (!event.lead_id || !toStage) continue
    history.add(event.lead_id)
    if (inRange(event.occurred_at, range) && movedUpInto(text(event.from_stage), toStage, threshold)) {
      keepEarliest(entries, event.lead_id, event.occurred_at)
    }
  }

  if (threshold === 3) {
    for (const appointment of input.appointments) {
      if (!appointment.lead_id || !inRange(appointment.created_at, range)) continue
      keepEarliest(entries, appointment.lead_id, appointment.created_at)
    }
  }

  for (const lead of input.leads) {
    if (history.has(lead.id) || entries.has(lead.id)) continue
    if (stageRank(lead.station) >= threshold && inRange(lead.created_at, range)) {
      keepEarliest(entries, lead.id, lead.created_at)
    }
  }

  return entries
}
