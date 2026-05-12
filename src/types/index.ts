export type PersonalityType = 'assertive' | 'analytical' | 'amiable' | 'accommodator' | 'expressive'

export type ActivityType = 'call' | 'sms' | 'email' | 'status_change'
export type ActivityDirection = 'in' | 'out'

export type TaskType = 'follow_up' | 'appointment' | 'send_offer' | 'review' | 'task'
export type TaskStatus = 'pending' | 'completed' | 'overdue'

export type DealStage =
  | 'new'
  | 'not_contacted'
  | 'contacted'
  | 'qualifying'
  | 'appt_set'
  | 'appointment_set'
  | 'negotiations'
  | 'contract_signed'
  | 'qualified'
  | 'offer_made'
  | 'under_contract'
  | 'disposition'
  | 'closed'
  | 'closed_won'
  | 'closed_lost'
  | 'dead'

export type ChecklistProtocol = 'sod' | 'eod'

export interface Contact {
  id: string
  first_name: string
  last_name: string
  email: string | null
  phone: string | null
  address: string | null
  city: string | null
  state: string | null
  zip: string | null
  personality_type: PersonalityType | null
  lead_score: number | null
  lead_owner: string | null
  smart_tags: string[]
  current_stage: DealStage | null
  created_at: string
  updated_at: string
}

export interface Deal {
  id: string
  contact_id: string
  property_address: string | null
  stage: DealStage
  arv: number | null
  as_is_value: number | null
  asking_price: number | null
  equity: number | null
  debt_total: number | null
  est_assignment: number | null
  ari_insight: string | null
  ari_tags: string[]
  created_at: string
  updated_at: string
  contact?: Contact
  // Manifest-sourced fields for Opportunities page
  _nextAction?: string | null
  _qualificationScore?: number | null
  _motivationScore?: number | null
}

export interface Activity {
  id: string
  contact_id: string | null
  deal_id: string | null
  type: ActivityType
  direction: ActivityDirection | null
  content: string | null
  outcome: string | null
  duration: number | null
  sentiment: string | null
  ai_summary: string | null
  created_at: string
  contact?: Contact
}

export interface Task {
  id: string
  type: TaskType
  title: string
  description: string | null
  contact_id: string | null
  deal_id: string | null
  property_address: string | null
  due_date: string | null
  assigned_to: string | null
  status: TaskStatus
  created_at: string
  contact?: Contact
}

export interface ChecklistSubmission {
  id: string
  protocol_type: ChecklistProtocol
  team_member: string
  status: string
  notes: string | null
  submitted_at: string
}

export interface EodReflection {
  id: string
  unexpected: string | null
  went_right: string | null
  lesson_learned: string | null
  submitted_at: string
}

export interface CallSession {
  id: string
  contact_id: string | null
  direction: ActivityDirection
  status: string
  started_at: string
  ended_at: string | null
  duration: number | null
  recording_url: string | null
  contact?: Contact
}

export interface KpiData {
  revenue: number
  expense: number
  profitMargin: number
  costPerLead: number
  avgAssignment: number
  acquisitionCost: number
  ltvCacRatio: number
  cashConversionDays: number
  dealsCount: number
}

export interface PipelineStats {
  leads: number
  opportunities: number
  offersMade: number
  dealsClosed: number
}
