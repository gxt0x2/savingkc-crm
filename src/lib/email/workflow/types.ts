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
export interface PilotThread {
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
  handoff_id: string | null
  handoff_state: string | null
  requested_contact: { phone?: string; requestedTimeText?: string } | null
}
export interface PilotMessage {
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
export interface PilotState {
  mode: 'simulation' | 'disabled'
  paused: boolean
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

export type InboxView =
  | 'action'
  | 'review'
  | 'calls'
  | 'ai'
  | 'waiting'
  | 'stopped'
  | 'all'
export function matchesView(thread: PilotThread, view: InboxView) {
  switch (view) {
    case 'action':
      return (
        thread.state === 'needs_review' ||
        thread.state === 'human' ||
        thread.handoff_state === 'held'
      )
    case 'review':
      return thread.state === 'needs_review' || thread.handoff_state === 'held'
    case 'calls':
      return thread.handoff_id !== null
    case 'ai':
      return false // No evaluated automatic actions exist in this pilot.
    case 'waiting':
      return thread.state === 'waiting'
    case 'stopped':
      return thread.state === 'stopped'
    case 'all':
      return true
  }
}
