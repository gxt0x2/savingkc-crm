export const ANDON_ISSUE_KINDS = ['process', 'system', 'data', 'improvement', 'ai_glitch'] as const
export type AndonIssueKind = typeof ANDON_ISSUE_KINDS[number]

export const ANDON_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type AndonPriority = typeof ANDON_PRIORITIES[number]

export const ANDON_STATUSES = ['open', 'acknowledged', 'in_progress', 'testing', 'resolved', 'closed'] as const
export type AndonStatus = typeof ANDON_STATUSES[number]

export const ANDON_WORK_AREAS = ['Marketing', 'Acquisitions', 'Dispositions', 'Transaction Coordination'] as const
export type AndonWorkArea = typeof ANDON_WORK_AREAS[number]

export const ANDON_PROCESS_CASCADES: Record<AndonWorkArea, string[]> = {
  Marketing: ['Skip Tracing Sync', 'PPC Landing Page', 'List Import Error'],
  Acquisitions: ['AI Text Bot Sequence', 'Cold Dialer Lag', 'Callback Automation'],
  Dispositions: ['Cash Buyer Email Blast', 'VIP List Tagging', 'SMS Blast Blocked'],
  'Transaction Coordination': ['Title Company Hand-off', 'EMD Tracking', 'Inspection Period Bug'],
}

export const ANDON_CASCADES = Object.fromEntries(
  ANDON_ISSUE_KINDS.map((kind) => [kind, ANDON_PROCESS_CASCADES]),
) as Record<AndonIssueKind, Record<AndonWorkArea, string[]>>

export const ANDON_KIND_LABELS: Record<AndonIssueKind, string> = {
  process: 'Process issue',
  system: 'System issue',
  data: 'Data concern',
  improvement: 'Improvement',
  ai_glitch: 'AI Glitch',
}

export function isAndonIssueKind(value: unknown): value is AndonIssueKind {
  return typeof value === 'string' && (ANDON_ISSUE_KINDS as readonly string[]).includes(value)
}

export function legacyFeedbackType(kind: AndonIssueKind): 'bug' | 'feature' | 'feedback' {
  if (kind === 'system' || kind === 'ai_glitch') return 'bug'
  if (kind === 'improvement') return 'feature'
  return 'feedback'
}

export function inferAndonIssueKind(type: string, description = ''): AndonIssueKind {
  const match = description.match(/^Issue type:\s*(process|system|data|improvement|ai_glitch)/im)?.[1]
  if (isAndonIssueKind(match)) return match
  if (type === 'bug' || type === 'error') return 'system'
  if (type === 'feature') return 'improvement'
  return 'data'
}

export interface AndonRecordContext {
  recordId: string | null
  recordType: 'lead' | 'property' | null
  recordUrl: string
}

export function extractAndonRecordContext(href: string): AndonRecordContext {
  try {
    const url = new URL(href)
    const segments = url.pathname.split('/').filter(Boolean)
    const leadIndex = segments.indexOf('leads')
    const dealIndex = segments.indexOf('deals')
    const queryLeadId = url.searchParams.get('lead_id') || url.searchParams.get('leadId')
    if (leadIndex >= 0 && segments[leadIndex + 1]) {
      return { recordId: decodeURIComponent(segments[leadIndex + 1]), recordType: 'lead', recordUrl: url.toString() }
    }
    if (queryLeadId) {
      const recordUrl = new URL(`/leads/${encodeURIComponent(queryLeadId)}`, url.origin)
      return { recordId: queryLeadId, recordType: 'lead', recordUrl: recordUrl.toString() }
    }
    if (dealIndex >= 0 && segments[dealIndex + 1]) {
      return { recordId: decodeURIComponent(segments[dealIndex + 1]), recordType: 'property', recordUrl: url.toString() }
    }
    return { recordId: null, recordType: null, recordUrl: url.toString() }
  } catch {
    return { recordId: null, recordType: null, recordUrl: href }
  }
}

export function encodeLegacyAndon(input: {
  issueKind: AndonIssueKind
  description: string
  fiveWhys: string[]
}) {
  const whyLines = input.fiveWhys
    .map((why, index) => `Why ${index + 1}: ${why.trim() || 'Not recorded'}`)
    .join('\n')
  return `Issue type: ${input.issueKind}\n\nWhat happened:\n${input.description.trim()}\n\n5 Whys:\n${whyLines}`
}

export function decodeLegacyAndon(description: string) {
  const happened = description.match(/What happened:\s*\n([\s\S]*?)(?:\n\n5 Whys:|$)/i)?.[1]?.trim() || description
  const fiveWhys = Array.from({ length: 5 }, (_, index) => (
    description.match(new RegExp(`Why ${index + 1}:\\s*(.*)`, 'i'))?.[1]?.trim() ?? ''
  )).map((why) => why === 'Not recorded' ? '' : why)
  return { happened, fiveWhys }
}
