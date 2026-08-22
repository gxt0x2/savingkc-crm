'use client'

import { useQuery } from '@tanstack/react-query'
import type { OperationalReconciliationSnapshot } from '@/lib/server/operational-reconciliation'

export function useOperationalReconciliation() {
  return useQuery({
    queryKey: ['operational-reconciliation'],
    queryFn: async (): Promise<OperationalReconciliationSnapshot> => {
      const response = await fetch('/api/reports/operational-reconciliation', { cache: 'no-store' })
      const payload = await response.json() as OperationalReconciliationSnapshot & { error?: string }
      if (!response.ok) throw new Error(payload.error || 'Backlog health is unavailable.')
      return payload
    },
    staleTime: 60_000,
    retry: 1,
  })
}
