'use client'

import { useQuery } from '@tanstack/react-query'
import { useSupabase } from './use-supabase'
import type { Deal, DealStage, Contact } from '@/types'

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  source: string | null
  priority: string | null
  station: string | null
  notes: string | null
  created_at: string
}

function rowToContact(row: LeadRow): Contact {
  const parts = (row.full_name || 'Unknown').split(' ')
  return {
    id: row.id,
    first_name: parts[0] || 'Unknown',
    last_name: parts.slice(1).join(' ') || '',
    email: row.email,
    phone: row.phone,
    address: row.property_address,
    city: row.city,
    state: row.state,
    zip: row.zip,
    personality_type: null,
    lead_score: row.priority === 'hot' ? 90 : row.priority === 'high' ? 75 : 60,
    lead_owner: null,
    smart_tags: row.priority === 'hot' ? ['Hot Lead'] : [],
    current_stage: (row.station as DealStage) || null,
    created_at: row.created_at,
    updated_at: row.created_at,
  }
}

function rowToDeal(row: LeadRow): Deal {
  return {
    id: row.id,
    contact_id: row.id,
    property_address: row.property_address,
    stage: (row.station as DealStage) || 'new',
    arv: null,
    as_is_value: null,
    asking_price: null,
    equity: null,
    debt_total: null,
    est_assignment: null,
    ari_insight: row.notes || null,
    ari_tags: row.source ? [row.source.replace(/_/g, ' ')] : [],
    created_at: row.created_at,
    updated_at: row.created_at,
    contact: rowToContact(row),
  }
}

export function useDeals(stage?: DealStage) {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['deals', stage],
    queryFn: async () => {
      let query = supabase
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, state, zip, source, priority, station, notes, created_at')
        .order('created_at', { ascending: false })

      if (stage) {
        query = query.eq('station', stage)
      }

      const { data, error } = await query
      if (error) throw error
      return (data as LeadRow[]).map(rowToDeal)
    },
  })
}

export function useDealsByStage() {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['deals', 'by-stage'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, state, zip, source, priority, station, notes, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error

      const stages: Record<DealStage, Deal[]> = {
        new: [],
        not_contacted: [],
        contacted: [],
        qualifying: [],
        qualified: [],
        appt_set: [],
        negotiations: [],
        contract_signed: [],
        offer_made: [],
        under_contract: [],
        disposition: [],
        closed: [],
        dead: [],
      }

      for (const deal of (data as LeadRow[]).map(rowToDeal)) {
        if (stages[deal.stage]) {
          stages[deal.stage].push(deal)
        }
      }

      return stages
    },
  })
}
