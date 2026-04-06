'use client'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { HotOpportunityData } from '@/types/hot-opportunity'

interface HotListResponse {
  items: HotOpportunityData[]
  lastRankedAt: string | null
}

export function useHotOpportunities() {
  return useQuery<HotListResponse>({
    queryKey: ['hot-opportunities'],
    queryFn: async () => {
      const res = await fetch('/api/hot-opportunities')
      if (!res.ok) throw new Error('Failed to fetch hot opportunities')
      return res.json()
    },
    staleTime: 60 * 1000, // 60s
    refetchOnWindowFocus: true,
  })
}

export function useRefreshHotList() {
  const queryClient = useQueryClient()

  return async (full?: boolean) => {
    await fetch('/api/hot-opportunities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(full ? { full: true } : {}),
    })
    await queryClient.invalidateQueries({ queryKey: ['hot-opportunities'] })
  }
}
