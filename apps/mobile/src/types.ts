export type CrmLead = {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip?: string | null
  county?: string | null
  station: string | null
  classification?: string | null
  dead_reason?: string | null
  assigned_agent?: string | null
  source?: string | null
  priority: string | null
  score?: number | null
  is_favorite?: boolean
  attention_state?: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  last_message?: string | null
  last_activity_at?: string | null
  primary_next_action?: {
    id: string
    title: string
    due_at: string | null
    owner: string | null
    overdue: boolean
  } | null
  motivation_score?: number | null
  seller_situation?: string | null
  appointment_date?: string | null
  updated_at: string | null
  created_at: string | null
}

export type LeadsResponse = {
  leads?: CrmLead[]
  counts?: Record<MobilePipelineList, number>
  pageInfo?: {
    total: number
    hasMore: boolean
    nextCursor: string | null
  }
  error?: string
}

export type MobilePipelineList =
  | 'new'
  | 'contacted'
  | 'qualified'
  | 'appointment_set'
  | 'offer_made'
  | 'in_closing'
  | 'all'

export type MobilePipelineResponse = {
  leads: CrmLead[]
  counts: Record<MobilePipelineList, number>
  pageInfo: {
    total: number
    hasMore: boolean
    nextCursor: string | null
  }
}

export type CrmActivity = {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

export type LeadDetailResponse = {
  lead?: CrmLead
  activities?: CrmActivity[]
  operations?: LeadOperations
  error?: string
}

export type MobileWorkItem = {
  key: string
  leadId: string | null
  title: string
  description: string | null
  status: 'pending' | 'completed' | 'blocked'
  priority: string
  dueAt: string | null
  assignedTo: string | null
  department: string
  primaryNextAction: boolean
  version: number
  contact?: {
    id: string
    fullName: string | null
    propertyAddress: string | null
  } | null
}

export type MobileHandoff = {
  id: string
  lead_id: string
  from_department: string
  to_department: string
  status: 'pending' | 'accepted' | 'completed'
  assigned_to: string | null
  reason: string | null
  evidence_type: string | null
  created_at: string
  leads?: {
    id: string
    full_name: string | null
    property_address: string | null
    city: string | null
    state: string | null
    station: string | null
    assigned_agent: string | null
  } | null
}

export type LeadOperations = {
  department: 'acquisitions' | 'dispositions' | 'transaction_coordination' | 'closed'
  owner: string | null
  primaryNextAction: MobileWorkItem | null
  tasksAvailable: boolean
  pendingHandoffs: MobileHandoff[]
  handoffsAvailable: boolean
}

export type MobileWorkResponse = {
  actor: string
  department: 'acquisitions' | 'dispositions' | 'tc'
  scope: 'mine' | 'unassigned'
  tasks: MobileWorkItem[]
  taskCounts: Record<string, number>
  handoffs: MobileHandoff[]
  serverNow: string
}

export type CallOutcome = 'connected' | 'missed' | 'voicemail' | 'bad_number' | 'busy' | 'unknown'

export type CallIntentKind = 'manual' | 'lead' | 'heir'

export type CallIntentAllowedResponse = {
  allowed: true
  intent: string
  to: string
  callerId: string
  kind: CallIntentKind
  leadId: string | null
  prospectPhoneId: string | null
  clientAttemptId: string
}

export type CallIntentDeniedResponse = {
  allowed: false
  error: string
  reason?: string
  reasonSource?: string
}

export type CallIntentResponse = CallIntentAllowedResponse | CallIntentDeniedResponse

export type MobileSession = {
  user: {
    id: string
    email: string | null
  }
  capabilities: {
    leadList: boolean
    leadDetail: boolean
    contacts: boolean
    conversations: boolean
    sms: boolean
    email: boolean
    outboundDeviceDialer: boolean
    callDisposition: boolean
    twilioNativeVoice: boolean
    workQueue: boolean
    ownerAssignment: boolean
    handoffAcceptance: boolean
    aiAssistantReadOnly: boolean
    calendar: boolean
  }
}

export type ConversationThread = CrmLead & {
  owner: string | null
  attentionState: 'needs_reply' | 'waiting_on_contact' | 'resolved'
  unread: boolean
  lastMessage: string
  lastActivityAt: string
  lastChannel: 'call' | 'sms' | 'email' | 'voicemail' | null
}

export type ConversationsResponse = {
  items?: ConversationThread[]
  error?: string
}

export type ConversationDetailResponse = {
  contact?: CrmLead
  activities?: CrmActivity[]
  error?: string
}

export type MobileCalendarItem = {
  id: string
  type: string
  title: string
  description: string | null
  contactId: string | null
  contactName: string | null
  propertyAddress: string | null
  dueAt: string
  assignedTo: string | null
  department: string
  priority: string
  status: 'pending' | 'blocked'
}

export type MobileCalendarResponse = {
  items: MobileCalendarItem[]
  serverNow: string
  error?: string
}

export type VoiceTokenResponse = {
  token: string
  identity: string
  callerId: string
  displayName: string
  error?: string
}

export type AssistantSource = {
  name: string
  url: string
  generatedAt?: string
  detail?: string
}

export type AssistantMessage = {
  id: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  sources: AssistantSource[]
  createdAt: string
}

export type AssistantThread = {
  id: string
  title: string
  status: 'active' | 'archived'
}

export type AssistantHistory = {
  thread: AssistantThread
  messages: AssistantMessage[]
}

export type AssistantCommandResponse = {
  reply: string
  threadId: string
  responseMessageId: string
  sources: AssistantSource[]
  error?: string
}
