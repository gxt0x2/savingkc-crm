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
  status: 'submitted' | 'reviewing' | 'countered' | 'accepted' | 'rejected' | 'withdrawn'
  counter_amount: number | null
  counter_notes: string | null
  submitted_at: string
  reviewed_at: string | null
  decided_at: string | null
  created_at: string
  updated_at: string
  buyer?: Buyer
  lead?: { id: string; property_address: string; full_name: string }
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
  }
  deal_page?: { id: string; slug: string; is_active: boolean } | null
  broadcasts_count?: number
  offers_count?: number
  accepted_buyer?: { id: string; first_name: string; last_name: string; company_name: string | null } | null
}
