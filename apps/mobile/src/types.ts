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
    outboundDeviceDialer: boolean
    callDisposition: boolean
    twilioNativeVoice: boolean
  }
}
