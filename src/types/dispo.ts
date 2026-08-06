export interface BuyBox {
  zip_codes?: string[]
  cities?: string[]
  counties?: string[]
  property_types?: string[]
  price_min?: number
  price_max?: number
  beds_min?: number
  condition_ok?: string[]
  notes?: string
}

export interface Buyer {
  id: string
  first_name: string
  last_name: string
  company_name: string | null
  email: string | null
  phone: string | null
  phone_2: string | null
  buy_box: BuyBox
  funding_type: string | null
  max_purchase_price: number | null
  monthly_capacity: number | null
  avg_close_days: number | null
  proof_of_funds: boolean
  status: 'active' | 'inactive' | 'blacklisted'
  tier: string
  source: string | null
  deals_closed: number
  last_deal_date: string | null
  sms_opted_in: boolean
  email_opted_in: boolean
  preferred_contact: string
  notes: string | null
  tags: string[]
  created_at: string
  updated_at: string
  // Canonical DB fields (actual table uses these)
  name?: string | null
  company?: string | null
}

export interface DealBroadcast {
  id: string
  lead_id: string
  status: 'draft' | 'scheduled' | 'sending' | 'sent' | 'cancelled'
  broadcast_type: 'auto_match' | 'manual_select' | 'blast_all'
  deal_snapshot: Record<string, unknown>
  match_criteria: Record<string, unknown>
  total_recipients: number
  sms_sent: number
  emails_sent: number
  sms_replies: number
  email_opens: number
  email_clicks: number
  offers_received: number
  scheduled_at: string | null
  sent_at: string | null
  created_by: string
  created_at: string
  updated_at: string
}

export interface BroadcastRecipient {
  id: string
  broadcast_id: string
  buyer_id: string
  sms_status: string
  sms_sid: string | null
  sms_sent_at: string | null
  sms_from: string | null
  email_status: string
  email_id: string | null
  email_sent_at: string | null
  sms_replied: boolean
  sms_reply_text: string | null
  sms_reply_at: string | null
  email_opened_at: string | null
  email_clicked_at: string | null
  match_score: number
  match_reasons: string[]
  created_at: string
  buyer?: Buyer
}

export interface BuyerOffer {
  id: string
  lead_id: string
  buyer_id: string
  broadcast_id: string | null
  offer_amount: number
  earnest_money: number | null
  close_days: number | null
  inspection_days: number | null
  financing_type: string | null
  contingencies: string | null
  notes: string | null
  status: 'pending' | 'submitted' | 'reviewing' | 'countered' | 'accepted' | 'rejected' | 'withdrawn' | 'expired'
  counter_amount: number | null
  counter_notes: string | null
  submitted_at: string
  reviewed_at: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
  is_top_pick?: boolean
  assignment_submission_id?: string | null
  assignment_assignee_submitter_id?: string | null
  assignment_sent_at?: string | null
  assignment_signed_at?: string | null
  assignment_document_url?: string | null
  tc_file?: TcFile | null
  buyer?: Buyer
  lead?: { id: string; property_address: string; full_name: string }
  deal_page?: { id: string; slug: string; title: string | null; asking_price?: number | null } | null
}

export interface InspectionReport {
  name: string
  url: string
  uploaded_at: string
}

export interface DealPage {
  id: string
  lead_id: string
  slug: string
  title: string | null
  description: string | null
  photos: string[]
  videos: string[]
  inspection_reports: InspectionReport[]
  show_address: boolean
  show_arv: boolean
  show_repair_estimate: boolean
  show_asking_price: boolean
  show_assignment_fee: boolean
  show_photos: boolean
  is_active: boolean
  requires_registration: boolean
  password: string | null
  view_count: number
  unique_visitors: number
  accept_offers: boolean
  offer_deadline: string | null
  contract_close_date: string | null
  earnest_money: number | null
  inspection_period_days: number | null
  financing_terms: string | null
  repair_estimate_low: number | null
  repair_estimate_high: number | null
  property_condition: string | null
  parking: string | null
  contract_notes: string | null
  assignment_fee: number | null
  asking_price: number | null
  purchase_price: number | null
  created_at: string
  updated_at: string
}

export interface BuyerMatch {
  buyer_id: string
  buyer: Buyer
  score: number
  reasons: string[]
}

export type DispoStage = 'new' | 'marketing' | 'offers_in' | 'negotiating' | 'under_contract' | 'closed' | 'dead'

export type DispoCloseoutStatus = 'not_started' | 'awaiting_debrief' | 'complete'

export interface DispoCloseoutData {
  version?: number
  funding?: {
    fundedAt?: string
    finalAssignmentFee?: number
    closingCosts?: number
    sellerPurchasePrice?: number | null
    buyerPurchasePrice?: number | null
    settlementStatementVerified?: boolean
    fundingConfirmed?: boolean
    notes?: string | null
    recordedBy?: string
    recordedAt?: string
  }
  metrics?: {
    grossRevenue?: number
    closingCosts?: number
    netRevenue?: number
    transactionSpread?: number | null
    dispositionDays?: number
    leadToCloseDays?: number | null
  }
  workflow?: {
    marketingStopped?: boolean
    transactionCoordinationClosed?: boolean
    debriefDueAt?: string
    sellerFollowupDueAt?: string
  }
  debrief?: {
    outcomeRating?: number
    buyerPerformance?: number
    sourceQuality?: number
    wentWell?: string
    friction?: string
    lesson?: string
    processChange?: string
    completedBy?: string
    completedAt?: string
  }
}

export interface DispoDeal {
  id: string
  lead_id: string
  stage: DispoStage
  entered_at: string
  assignment_fee: number | null
  close_date: string | null
  accepted_offer_id: string | null
  accepted_buyer_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
  closeout_status?: DispoCloseoutStatus | null
  closeout?: DispoCloseoutData | null
  closed_at?: string | null
  debrief_due_at?: string | null
  debrief_completed_at?: string | null
  archived_at?: string | null
  lead?: {
    id: string
    full_name: string | null
    property_address: string | null
    city: string | null
    state: string | null
    zip: string | null
    arv: number | null
    offer_amount: number | null
    property_type: string | null
    beds: number | null
    baths_full: number | null
    sqft: number | null
    source?: string | null
    assigned_agent?: string | null
    created_at?: string | null
  }
  deal_page?: { id: string; slug: string; is_active: boolean } | null
  tc_file?: TcFile | null
  broadcasts_count?: number
  offers_count?: number
  accepted_buyer?: { id: string; first_name: string; last_name: string; company_name: string | null } | null
}

export type TcStatus =
  | 'not_opened'
  | 'opening_package_needed'
  | 'opened'
  | 'emd_pending'
  | 'title_work'
  | 'clear_to_close'
  | 'scheduled'
  | 'closed'
  | 'cancelled'

export type TcRiskLevel = 'normal' | 'watch' | 'urgent' | 'blocked'

export type TcDraftStatus = 'pending' | 'approved' | 'rejected' | 'sending' | 'sent' | 'superseded'
export type TcDraftChannel = 'email' | 'document' | 'sms'
export type TcDraftRecipientRole = 'buyer' | 'seller' | 'title' | 'internal'

export interface TcDraft {
  id: string
  tc_file_id: string
  template_id: string | null
  lead_id: string
  channel: TcDraftChannel
  recipient_role: TcDraftRecipientRole
  recipient_email: string | null
  recipient_phone: string | null
  subject: string | null
  draft_body: string
  edited_body: string | null
  approved_body: string | null
  status: TcDraftStatus
  rejection_notes: string | null
  created_by: string
  approved_by: string | null
  created_at: string
  updated_at: string
  approved_at: string | null
  sent_at: string | null
  metadata: Record<string, unknown> | null
  template?: {
    id: string
    slug: string
    title: string
    template_type: 'email' | 'document' | 'checklist'
    audience: TcDraftRecipientRole
    subject: string | null
    body: string
  } | null
  file?: TcFile | null
}

export interface TcTask {
  id: string
  tc_file_id: string
  task_type: string
  label: string
  status: 'open' | 'done' | 'waived' | 'blocked'
  due_at: string | null
  completed_at: string | null
  assigned_to: string | null
  source: string
  notes: string | null
  created_at?: string
  updated_at?: string
}

export interface TcFile {
  id: string
  lead_id: string
  dispo_deal_id: string | null
  buyer_offer_id: string | null
  title_company_id: string | null
  title_contact_id: string | null
  file_number: string | null
  status: TcStatus
  opened_at: string | null
  emd_due_at: string | null
  emd_confirmed_at: string | null
  title_clear_at: string | null
  closing_scheduled_at: string | null
  closing_completed_at: string | null
  hud_received_at: string | null
  assignment_fee: number | null
  revenue_logged_at: string | null
  next_action: string | null
  risk_level: TcRiskLevel
  risk_reason: string | null
  notes: string | null
  created_at: string
  updated_at: string
  tasks?: TcTask[]
  drafts?: TcDraft[]
  events?: TcEvent[]
  title_company?: { id: string; name: string; office_phone?: string | null; office_email?: string | null } | null
  title_contact?: { id: string; name: string; role?: string | null; email?: string | null; phone?: string | null } | null
  lead?: { id: string; full_name: string | null; phone: string | null; email: string | null; property_address: string | null; city: string | null; state: string | null; zip: string | null } | null
  offer?: BuyerOffer | null
  dispo_deal?: {
    id: string
    stage: DispoStage
    entered_at?: string | null
    assignment_fee: number | null
    close_date: string | null
    accepted_offer_id?: string | null
    accepted_buyer_id?: string | null
    updated_at?: string | null
  } | null
}

export interface TcEvent {
  id: string
  tc_file_id: string
  event_type: string
  payload: Record<string, unknown> | null
  actor: string | null
  created_at: string
}

export interface TcCommunication {
  id: string
  activity_type: string
  title: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}
