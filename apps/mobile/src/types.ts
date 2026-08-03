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
  priority: string | null
  motivation_score?: number | null
  seller_situation?: string | null
  appointment_date?: string | null
  updated_at: string | null
  created_at: string | null
}

export type LeadsResponse = {
  leads?: CrmLead[]
  error?: string
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
  error?: string
}

export type CallOutcome = 'connected' | 'missed' | 'voicemail' | 'bad_number' | 'busy' | 'unknown'

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

export type VoiceTokenResponse = {
  token: string
  identity: string
  callerId: string
  displayName: string
  error?: string
}
