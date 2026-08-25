export interface ProspectingCallingLead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  county: string | null
  is_favorite: boolean | null
}

export interface ProspectingCallingProspect {
  id: string
  owner_1: string | null
  cumulative_due: number | null
  earliest_delinquent_year: number | null
  delinquent_years_category: string | null
  total_market_value: number | null
  zestimate: number | null
  situs_street: string | null
  situs_city: string | null
  situs_state: string | null
  situs_zip: string | null
  mailing_street: string | null
  mailing_city: string | null
  mailing_state: string | null
  mailing_zip: string | null
  county: string | null
  is_deceased: boolean | null
  occupancy_status: string | null
}

export interface ProspectingRecentCall {
  id: string
  lead_id: string | null
  lead_name: string | null
  phone: string | null
  created_at: string
  agent: string | null
  metadata: Record<string, unknown> | null
}

export type ProspectingCallingTab = 'texts' | 'activity' | 'recent_calls'

export interface ProspectingOccupancy {
  label: 'Vacant' | 'Absentee' | 'Owner occupied'
  tone: 'warn' | 'amber' | 'neutral'
}

export interface ProspectingSmsTarget {
  heirName: string
  relation: string
  phone: string
  prospectPhoneId: string
  deceasedOwnerName: string
}

export interface ProspectingCallingContext {
  lead: ProspectingCallingLead | null
  prospect: ProspectingCallingProspect | null
  ownerName: string
  situsAddress: string
}

export interface ProspectingCallingQueueState {
  queueItem: {
    phone: string
    heirName: string
    relation: string
    prospect_phone_id: string
    leadId: string | null
    prospectId: string
    campaignMemberId: string | null
  } | null
  queueIndex: number
  queueLength: number
  callDuration?: string | null
  status: 'offline' | 'connecting' | 'ready' | 'calling' | 'on_call' | 'incoming'
}
