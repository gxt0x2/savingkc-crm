'use client'

import { useQuery } from '@tanstack/react-query'
import { useSupabase } from './use-supabase'
import type { Contact, DealStage } from '@/types'

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  priority: string | null
  station: string | null
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
    smart_tags: [],
    current_stage: (row.station as DealStage) || null,
    created_at: row.created_at,
    updated_at: row.created_at,
  }
}

export function useContacts() {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['contacts'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, state, zip, priority, station, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data as LeadRow[]).map(rowToContact)
    },
  })
}

export function useContact(id: string) {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['contacts', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, state, zip, priority, station, created_at')
        .eq('id', id)
        .single()
      if (error) throw error
      return rowToContact(data as LeadRow)
    },
    enabled: !!id,
  })
}
