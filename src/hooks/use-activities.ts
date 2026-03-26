'use client'

import { useQuery } from '@tanstack/react-query'
import { useSupabase } from './use-supabase'
import type { Activity } from '@/types'

export function useActivities(contactId?: string) {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['activities', contactId],
    queryFn: async () => {
      let query = supabase
        .from('lead_activities')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50)

      if (contactId) {
        query = query.eq('lead_id', contactId)
      }

      const { data, error } = await query
      if (error) throw error
      return data as Activity[]
    },
  })
}
