import type { EmailWorkspaceConfig } from '../config'
import type { EmailCommand } from '../contracts'

export type PilotConfig = Extract<
  EmailCommand,
  { command: 'CAM-SAVE' }
>['payload']['draftConfig']
export interface RecipientReview {
  id: string
  addressId: string
  partyId: string
  name: string
  email: string
  eligible: boolean
  reasons: string[]
}
export interface PilotReview {
  campaignId: string
  revision: number
  draftHash: string
  audienceHash: string
  estimateHash: string
  readinessRunId: string
  recipients: RecipientReview[]
}
export interface PilotCampaign {
  id: string
  name: string
  state: string
  revision: number
  draft_config: Partial<PilotConfig>
  started: number
  approved: number
  next_send: string | null
}
export type PilotCrmSyncState =
  | 'not_connected'
  | 'pending'
  | 'synced'
  | 'review_required'
  | 'dependency_unavailable'
export type PilotCrmSyncReason =
  | 'seller_interest_unconfirmed'
  | 'identity_unconfirmed'
  | 'contact_identity_conflict'
  | 'property_unconfirmed'
  | 'property_ambiguous'
  | 'existing_record_held'
  | 'owner_conflict'
  | 'governed_transition_required'
  | 'canonical_dependency_missing'
  | 'schema_incompatible'
  | 'legacy_handoff_requires_review'
export type PilotCallbackTaskState =
  | 'pending'
  | 'blocked'
  | 'completed'
  | 'cancelled'
export interface PilotThread {
  callback_request?: { messageId: string; phone: string; time?: string; explicitCall?: boolean; testOnly: boolean; reviewed: boolean } | null
  inbound_pending?: boolean
  id: string
  campaign_id: string
  campaign_name: string
  name: string
  email: string
  address_id: string
  subject: string
  controller: string
  controller_user_id: string | null
  responsible_user_id: string
  controller_revision: number
  content_revision: number
  state: string
  outcome: string
  last_message_at: string | null
  lead_id: string | null
  lead_stage: string | null
  lead_classification: string | null
  lead_source: string | null
  handoff_id: string | null
  handoff_state: string | null
  handoff_owner_id: string | null
  handoff_backup_id: string | null
  crm_sync_state: PilotCrmSyncState | null
  crm_sync_reason: PilotCrmSyncReason | null
  crm_task_id: string | null
  crm_task_key: string | null
  crm_history_repair_required: boolean
  crm_callback_repair_required: boolean
  crm_repair_id: string | null
  crm_repair_error_code: string | null
  callback_task_state: PilotCallbackTaskState | null
  callback_due_at: string | null
  requested_contact: { phone?: string; requestedTimeText?: string } | null
  handoff_revision?: number | null
  ai_generation?: {
    id: string
    state: 'queued' | 'running' | 'ready' | 'stale' | 'failed'
    model: string
    output: {
      decision: 'reply' | 'review' | 'stop'
      body: string
      summary: string
      reason: string
      evidence: { messageId: string; quote: string }[]
    } | null
    content_revision: number
    controller_revision: number
    created_at: string
    failure_code: string | null
    input_tokens: number | null
    output_tokens: number | null
    estimated_cost_usd: number | string | null
  } | null
  crm_owner_name?: string | null
  callback_owner_changed?: boolean
  open_task_count?: number
  open_tasks?: {
    key: string
    source_id: string
    title: string
    kind: string
    status: 'pending' | 'blocked'
    due_at: string | null
    assigned_to: string | null
    notes: string | null
  }[]
  callback_title?: string | null
  callback_notes?: string | null
  scheduled_for?: string | null
  sending_issue?: string | null
  reply_queued?: boolean
  has_outbound?: boolean
  next_email_at?: string | null
  property?: {
    id: string
    address: string
    city: string | null
    state: string | null
    zip: string | null
    county: string | null
    property_type: string | null
    bedrooms: number | null
    bathrooms: number | null
    sqft: number | null
    year_built: number | null
    zestimate?: number | null
  } | null
  notes?: {
    id: string
    body: string
    author: string | null
    created_at: string
  }[]
}
export interface PilotMessage {
  transport?: string
  attachment_metadata?: {
    id: string
    filename: string
    content_type: string
    size?: number
  }[]
  id: string
  thread_id: string
  direction: string
  text_body: string
  occurred_at: string
}
export interface PilotDraft {
  id: string
  thread_id: string
  body: string
  body_hash: string
  content_revision: number
  controller_revision: number
  state: string
}
export interface PilotSettings {
  revision: number
  config: EmailWorkspaceConfig
  members: {
    id: string
    name: string
    roles: string[]
    active: boolean
    crm_active: boolean
    revision: number
    affectedWorkHash: string
    affectedThreads: number
  }[]
  readiness: { state: 'blocked' | 'ready'; sendingEnabled: boolean; blockers: string[] }
}
export interface PilotState {
  ai_available?: boolean
  sendingEnabled?: boolean
  senders?: { id: string; name: string; address: string }[]
  routing: { acquisitionOwnerId: string; backupId: string } | null
  settings: PilotSettings | null
  mode: 'simulation' | 'disabled' | 'hosted'
  paused: boolean
  pauseReason?: string | null
  actorId: string
  roles: string[]
  asOf: string
  campaigns: PilotCampaign[]
  threads: PilotThread[]
  messages: PilotMessage[]
  drafts: PilotDraft[]
  audiences: { id: string; name: string }[]
  members: { id: string; name: string }[]
  notifications: {
    id: string
    thread_id: string
    kind: string
    acknowledged_at: string | null
  }[]
  activity: { id: string; action: string; created_at: string }[]
}

export type InboxView = 'action' | 'waiting' | 'scheduled' | 'done' | 'all'

// One primary work queue per conversation. Restrictions remain independent.
export function primaryView(
  thread: PilotThread,
  asOf: string,
): Exclude<InboxView, 'all'> {
  const issue =
    thread.sending_issue ||
    thread.callback_owner_changed ||
    thread.crm_history_repair_required ||
    thread.crm_callback_repair_required ||
    ['pending', 'review_required', 'dependency_unavailable'].includes(
      thread.crm_sync_state ?? '',
    ) ||
    thread.handoff_state === 'held' ||
    thread.callback_task_state === 'blocked'
  if (issue) return 'action'
  if (thread.callback_request && !thread.callback_request.reviewed) return 'action'
  if (thread.state === 'stopped' && thread.callback_task_state === 'pending') return thread.scheduled_for && new Date(thread.scheduled_for) > new Date(asOf) ? 'scheduled' : 'action'
  if (thread.state === 'stopped' || thread.state === 'done') return 'done'
  if (thread.state === 'needs_review') return 'action'
  if (thread.scheduled_for && thread.callback_task_state === 'pending')
    return new Date(thread.scheduled_for) > new Date(asOf)
      ? 'scheduled'
      : 'action'
  if (thread.callback_task_state === 'pending') return 'action'
  if (thread.reply_queued) return 'scheduled'
  if (thread.state === 'human') return 'action'
  return thread.has_outbound ? 'waiting' : 'scheduled'
}
export function matchesView(
  thread: PilotThread,
  view: InboxView,
  asOf = new Date().toISOString(),
) {
  return view === 'all' || primaryView(thread, asOf) === view
}
