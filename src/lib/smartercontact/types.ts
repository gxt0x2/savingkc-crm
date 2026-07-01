/** Shared types for the SmarterContact module (sc_* tables). */

export interface ScContact {
  id: string
  first_name: string | null
  last_name: string | null
  phone: string
  email: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  tags: string[]
  custom_fields: Record<string, unknown>
  lead_id: string | null
  status: 'active' | 'deleted'
  source: string | null
  created_at: string
  updated_at: string
}

export interface ScGroup {
  id: string
  name: string
  description: string | null
  source: 'upload' | 'manual' | 'filter'
  contact_count: number
  created_at: string
  updated_at: string
}

export interface ScConversation {
  id: string
  contact_id: string | null
  contact_phone: string
  sending_number: string | null
  last_message_at: string | null
  last_direction: 'inbound' | 'outbound' | null
  last_body: string | null
  unread_count: number
  is_read: boolean
  awaiting_reply: boolean
  has_replied: boolean
  opted_out: boolean
  missed_call: boolean
  status: 'open' | 'deleted'
  assigned_to: string | null
  created_at: string
  updated_at: string
}

export interface ScMessage {
  id: string
  conversation_id: string
  contact_id: string | null
  contact_phone: string
  sending_number: string | null
  direction: 'inbound' | 'outbound'
  body: string
  segments: number
  status: string
  twilio_sid: string | null
  error_code: number | null
  campaign_id: string | null
  workflow_id: string | null
  created_at: string
}

export type ScCampaignStatus =
  | 'draft'
  | 'scheduled'
  | 'active'
  | 'paused'
  | 'completed'
  | 'deleted'

export interface ScCampaign {
  id: string
  name: string
  type: 'standard' | 'keyword'
  status: ScCampaignStatus
  group_id: string | null
  message_body: string | null
  template_id: string | null
  from_strategy: 'pool' | 'single'
  sending_number_ids: string[]
  throttle_per_hour: number
  send_window_start: string | null
  send_window_end: string | null
  timezone: string
  keyword: string | null
  keyword_number: string | null
  auto_reply_body: string | null
  scheduled_at: string | null
  started_at: string | null
  completed_at: string | null
  total_recipients: number
  sent_count: number
  delivered_count: number
  failed_count: number
  reply_count: number
  optout_count: number
  created_by: string | null
  created_at: string
  updated_at: string
}

export interface ScWorkflow {
  id: string
  name: string
  status: 'active' | 'paused' | 'draft'
  trigger: 'manual' | 'on_reply' | 'on_group_add' | 'on_keyword'
  from_strategy: 'pool' | 'single'
  sending_number_ids: string[]
  enrolled_count: number
  created_at: string
  updated_at: string
}

export interface ScWorkflowStep {
  id: string
  workflow_id: string
  step_order: number
  delay_days: number
  delay_hours: number
  channel: 'sms'
  body: string
  template_id: string | null
  created_at: string
}

export const INBOX_FILTERS = [
  { key: 'all', label: 'All', icon: 'mail' },
  { key: 'unread', label: 'Unread', icon: 'mark_email_unread' },
  { key: 'missed_calls', label: 'Missed calls', icon: 'phone_missed' },
  { key: 'unreplied', label: 'Unreplied', icon: 'forum' },
  { key: 'awaiting_reply', label: 'Awaiting reply', icon: 'schedule' },
  { key: 'opted_out', label: 'Opted out', icon: 'block' },
  { key: 'deleted', label: 'Deleted', icon: 'delete' },
] as const

export type InboxFilterKey = (typeof INBOX_FILTERS)[number]['key']
