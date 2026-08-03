export type RecordKind =
  | 'contact'
  | 'property'
  | 'opportunity'
  | 'conversation'
  | 'appointment'
  | 'task'
  | 'workflow'

export type OwnerKind = 'user' | 'team' | 'system'

export interface RecordOwner {
  kind: OwnerKind
  id: string
  displayName: string
}

export type CanonicalOpportunityStage =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'offer_made'
  | 'under_contract'
  | 'disposition'
  | 'closed'
  | 'dead'

export interface NextAction {
  id: string
  opportunityId: string
  type: 'call' | 'sms' | 'email' | 'appointment' | 'review' | 'task'
  title: string
  dueAt: string
  owner: RecordOwner
  status: 'pending' | 'completed' | 'cancelled'
  source: 'manual' | 'stage_rule' | 'workflow'
  sourceId?: string
}

export type ConversationChannel = 'sms' | 'call' | 'voicemail' | 'email'
export type ConversationAttentionState = 'needs_reply' | 'waiting_on_contact' | 'resolved'

export interface ConversationState {
  id: string
  contactId: string | null
  opportunityId: string | null
  channel: ConversationChannel
  owner: RecordOwner | null
  attentionState: ConversationAttentionState
  unreadByUserIds: string[]
  lastInboundAt: string | null
  lastOutboundAt: string | null
  resolvedAt: string | null
}

export type WorkflowCategory =
  | 'phone_routing'
  | 'lead_intake'
  | 'appointment'
  | 'communication'
  | 'pipeline'
  | 'nurture'
  | 'dispositions'
  | 'data_sync'
  | 'reporting'
  | 'operating_rhythm'
  | 'ai'

export type WorkflowStatus = 'draft' | 'active' | 'paused' | 'archived'
export type WorkflowHealth = 'healthy' | 'warning' | 'error' | 'not_run'

export type WorkflowTrigger =
  | { type: 'inbound_call'; phoneNumber: string }
  | { type: 'inbound_sms'; phoneScope: 'all_owned_numbers' }
  | { type: 'lead_form_submitted'; formKey: string }
  | { type: 'appointment_status_changed'; toStatus: 'scheduled' | 'confirmed' | 'completed' | 'no_show' | 'cancelled' | 'rescheduled' }
  | { type: 'conversation_attention_changed'; toState: ConversationAttentionState }
  | { type: 'opportunity_stage_changed'; toStage: CanonicalOpportunityStage }
  | { type: 'scheduled'; schedule: string }
  | { type: 'webhook'; event: string }
  | { type: 'record_changed'; record: string; event: string }
  | { type: 'manual'; surface: string }

export type WorkflowAction =
  | { type: 'normalize_identity' }
  | { type: 'find_or_create_contact' }
  | { type: 'find_or_create_property' }
  | { type: 'create_opportunity'; stage: CanonicalOpportunityStage }
  | { type: 'assign_owner'; strategy: 'fixed' | 'round_robin' | 'source_based'; ownerId?: string }
  | { type: 'send_sms'; templateId: string; consentRequired: true }
  | { type: 'send_email'; templateId: string }
  | { type: 'create_next_action'; actionType: NextAction['type']; title: string; dueOffsetMinutes: number }
  | { type: 'create_calendar_event' }
  | { type: 'notify_owner'; urgency: 'normal' | 'urgent' }
  | { type: 'ring_owner'; timeoutSeconds: number }
  | { type: 'ring_team'; teamId: string; timeoutSeconds: number }
  | { type: 'record_voicemail' }
  | { type: 'stop_future_reminders' }
  | { type: 'wait_until'; relativeTo: 'appointment'; offsetMinutes: number }
  | { type: 'branch'; condition: string }
  | { type: 'execute'; label: string }

export interface WorkflowImplementation {
  sourceFiles: readonly string[]
  execution: 'route' | 'worker' | 'library' | 'configuration'
  schedule?: string
  mutatesData: boolean
  approvalPolicy: 'automatic' | 'user_confirmation' | 'admin_only'
}

export interface WorkflowDefinition {
  id: string
  name: string
  description: string
  category: WorkflowCategory
  status: WorkflowStatus
  health: WorkflowHealth
  owner: RecordOwner
  trigger: WorkflowTrigger
  actions: WorkflowAction[]
  protectedResources?: string[]
  implementation: WorkflowImplementation
  version: number
  lastRunAt: string | null
}
