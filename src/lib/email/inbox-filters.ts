export type InboxBucket =
  | 'needs_action'
  | 'needs_review'
  | 'calls_appointments'
  | 'ai_handling'
  | 'waiting'
  | 'closed_stopped'
  | 'all'

export type WorkspaceInboxView =
  | 'action'
  | 'waiting'
  | 'scheduled'
  | 'done'
  | 'all'

const buckets: InboxBucket[] = [
  'needs_action',
  'needs_review',
  'calls_appointments',
  'ai_handling',
  'waiting',
  'closed_stopped',
  'all',
]

export function normalizeInboxBucket(value: string): InboxBucket {
  return buckets.includes(value as InboxBucket)
    ? (value as InboxBucket)
    : 'needs_action'
}

export function workspaceViewFromQuery(view: InboxBucket): WorkspaceInboxView {
  if (view === 'waiting') return 'waiting'
  if (view === 'calls_appointments') return 'scheduled'
  if (view === 'closed_stopped') return 'done'
  if (view === 'all') return 'all'
  return 'action'
}

export function queryViewFromWorkspace(
  view: WorkspaceInboxView,
): InboxBucket {
  if (view === 'waiting') return 'waiting'
  if (view === 'scheduled') return 'calls_appointments'
  if (view === 'done') return 'closed_stopped'
  if (view === 'all') return 'all'
  return 'needs_action'
}

export function inboxQueryAllowlisted(query: {
  view: string
  ownerId?: string
  campaignId?: string
  search?: string
  reasons?: string[]
  outcomes?: string[]
  controllers?: string[]
  unread?: boolean
}) {
  return (
    buckets.includes(query.view as InboxBucket) &&
    (query.reasons?.length ?? 0) <= 20 &&
    (query.outcomes?.length ?? 0) <= 20 &&
    (query.controllers?.every((c) => ['ai', 'human', 'none'].includes(c)) ??
      true)
  )
}
