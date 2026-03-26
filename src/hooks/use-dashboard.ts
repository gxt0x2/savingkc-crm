'use client'

import { useQuery } from '@tanstack/react-query'
import { useSupabase } from './use-supabase'
import type { PipelineStats } from '@/types'

export function usePipelineStats() {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['pipeline-stats'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select('stage')
      if (error) throw error

      const stats: PipelineStats = {
        leads: data.length,
        opportunities: data.filter(d => ['qualifying', 'appt_set', 'negotiations'].includes(d.stage)).length,
        offersMade: data.filter(d => d.stage === 'negotiations').length,
        dealsClosed: data.filter(d => d.stage === 'contract_signed').length,
      }
      return stats
    },
  })
}

export function useDealAggregates() {
  const supabase = useSupabase()

  return useQuery({
    queryKey: ['deal-aggregates'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deals')
        .select('est_assignment, stage')
      if (error) throw error

      const closed = data.filter(d => d.stage === 'contract_signed')
      const revenue = closed.reduce((sum, d) => sum + (d.est_assignment || 0), 0)
      const avgAssignment = closed.length > 0 ? revenue / closed.length : 0

      return {
        revenue,
        dealsCount: closed.length,
        avgAssignment,
      }
    },
  })
}
