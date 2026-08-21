import type { AcquisitionThread } from '@/lib/acquisitions-report'

export const OPERATING_REPORT_ROW_LIMIT = 5_000
export const OPERATING_REPORT_ACTIVITY_LIMIT = 20_000
export const OPERATING_REPORT_ID_BATCH = 250

export interface ConversationReportStateRow {
  lead_id: string | null
  attention_state: string | null
  owner: string | null
  last_activity_at: string | null
  primary_next_action_id: string | null
  primary_next_action_due_at: string | null
}

export function takeBoundedRows<T>(rows: readonly T[] | null | undefined, limit: number) {
  const source = rows ?? []
  return {
    rows: source.slice(0, limit),
    complete: source.length <= limit,
  }
}

export function chunksOf<T>(rows: readonly T[], size = OPERATING_REPORT_ID_BATCH): T[][] {
  if (!Number.isInteger(size) || size < 1) throw new Error('Chunk size must be a positive integer')
  const chunks: T[][] = []
  for (let index = 0; index < rows.length; index += size) chunks.push(rows.slice(index, index + size))
  return chunks
}

export function uniqueRowsById<T extends { id: string }>(...groups: ReadonlyArray<readonly T[]>): T[] {
  const rows = new Map<string, T>()
  for (const group of groups) {
    for (const row of group) rows.set(row.id, row)
  }
  return [...rows.values()]
}

export function conversationStatesToThreads(
  rows: readonly ConversationReportStateRow[],
  reportUntil: Date,
): AcquisitionThread[] {
  const until = reportUntil.getTime()
  return rows.flatMap((row) => {
    if (!row.lead_id) return []
    const dueAt = row.primary_next_action_due_at ? new Date(row.primary_next_action_due_at).getTime() : null
    const attentionState = row.attention_state === 'needs_reply' || row.attention_state === 'waiting_on_contact'
      ? row.attention_state
      : 'resolved'
    return [{
      id: row.lead_id,
      attentionState,
      owner: row.owner,
      lastActivityAt: row.last_activity_at,
      primaryNextAction: row.primary_next_action_id
        ? { overdue: dueAt !== null && Number.isFinite(dueAt) && dueAt < until }
        : null,
    }]
  })
}
