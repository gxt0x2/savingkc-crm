'use client'

import { useQuery } from '@tanstack/react-query'
import type { TaskProvenanceSummary } from '@/lib/server/task-provenance'

export function useTaskProvenance() {
  return useQuery({
    queryKey: ['task-provenance-summary'],
    queryFn: async () => {
      const response = await fetch('/api/reports/task-provenance', { cache: 'no-store' })
      const payload = await response.json() as TaskProvenanceSummary & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Task integrity evidence is unavailable.')
      return payload
    },
    staleTime: 30_000,
  })
}
