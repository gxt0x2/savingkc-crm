export interface DialerPreCallObjective {
  title: string
  description: string | null
  dueAt: string | null
  kind: string
  source: 'work_item' | 'appointment'
}

export interface DialerPreCallEvidence {
  id: string
  kind: 'call' | 'message' | 'note' | 'status'
  direction: 'inbound' | 'outbound' | null
  summary: string
  createdAt: string
}

export interface DialerPreCallBrief {
  leadId: string
  snapshotAt: string
  contact: {
    name: string
    address: string | null
    station: string | null
    priority: string | null
  }
  objective: DialerPreCallObjective | null
  aiBriefing: {
    situation: string | null
    motivation: string | null
    strategy: string | null
    generatedAt: string
    freshness: 'current' | 'stale'
  } | null
  facts: Array<{ label: string; value: string }>
  questions: string[]
  coOwners: string[]
  recentEvidence: DialerPreCallEvidence[]
  sourceRowCount: number
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

export function parseDialerPreCallBrief(value: unknown): DialerPreCallBrief | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Partial<DialerPreCallBrief>
  if (!text(row.leadId) || !text(row.snapshotAt) || !row.contact || !text(row.contact.name)) return null
  return row as DialerPreCallBrief
}
