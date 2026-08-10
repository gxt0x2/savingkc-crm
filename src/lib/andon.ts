export const ANDON_ISSUE_KINDS = ['process', 'system', 'data', 'improvement'] as const
export type AndonIssueKind = typeof ANDON_ISSUE_KINDS[number]

export const ANDON_PRIORITIES = ['low', 'medium', 'high', 'critical'] as const
export type AndonPriority = typeof ANDON_PRIORITIES[number]

export const ANDON_STATUSES = ['open', 'acknowledged', 'in_progress', 'testing', 'resolved', 'closed'] as const
export type AndonStatus = typeof ANDON_STATUSES[number]

export const ANDON_CASCADES: Record<AndonIssueKind, Record<string, string[]>> = {
  process: {
    Marketing: ['Google Ads', 'Lead source and attribution', 'Landing page or form', 'Lead quality', 'Campaign handoff'],
    Acquisitions: ['Lead intake and assignment', 'Speed to lead', 'Conversation and follow-up', 'Appointment', 'Offer or contract'],
    Dispositions: ['Buyer marketing', 'Buyer offer', 'Assignment', 'Transaction coordination', 'Closing or debrief'],
  },
  system: {
    'CRM experience': ['Navigation or page', 'Button, link, or field', 'Theme or readability', 'Loading or performance'],
    Communications: ['Inbound call', 'Outbound call', 'SMS', 'Email', 'Recording or voicemail'],
    'Workflows and automation': ['Trigger', 'Routing', 'Task or reminder', 'Phone number path'],
    Integrations: ['Google Ads', 'Twilio', 'Supabase', 'Email', 'Other integration'],
    'Access and security': ['Sign in', 'Role or permission', 'Mobile access', 'Other access issue'],
  },
  data: {
    'Contact or lead': ['Identity or duplicate', 'Owner or assignment', 'Stage or status', 'Property data'],
    Communications: ['Missing activity', 'Incorrect direction', 'Incorrect outcome', 'Missing recording'],
    Marketing: ['Source attribution', 'Campaign attribution', 'Conversion export', 'Spend or lead count'],
    Dispositions: ['Buyer data', 'Offer data', 'Assignment data', 'Closing data'],
    Reporting: ['Incorrect metric', 'Missing metric', 'Date range', 'Data freshness'],
  },
  improvement: {
    Marketing: ['Faster decision', 'Clearer data', 'Automation opportunity', 'New capability'],
    Acquisitions: ['Faster decision', 'Clearer data', 'Automation opportunity', 'New capability'],
    Dispositions: ['Faster decision', 'Clearer data', 'Automation opportunity', 'New capability'],
    System: ['Faster navigation', 'Clearer interface', 'Automation opportunity', 'New capability'],
  },
}

export const ANDON_KIND_LABELS: Record<AndonIssueKind, string> = {
  process: 'Process issue',
  system: 'System issue',
  data: 'Data concern',
  improvement: 'Improvement',
}

export function isAndonIssueKind(value: unknown): value is AndonIssueKind {
  return typeof value === 'string' && (ANDON_ISSUE_KINDS as readonly string[]).includes(value)
}

export function legacyFeedbackType(kind: AndonIssueKind): 'bug' | 'feature' | 'feedback' {
  if (kind === 'system') return 'bug'
  if (kind === 'improvement') return 'feature'
  return 'feedback'
}

export function inferAndonIssueKind(type: string, description = ''): AndonIssueKind {
  const match = description.match(/^Issue type:\s*(process|system|data|improvement)/im)?.[1]
  if (isAndonIssueKind(match)) return match
  if (type === 'bug' || type === 'error') return 'system'
  if (type === 'feature') return 'improvement'
  return 'data'
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
