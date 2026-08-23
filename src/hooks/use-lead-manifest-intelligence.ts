'use client'

import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

export type LeadManifestIntelligence = Record<string, unknown>

type LeadIntelligenceResponse = {
  manifest?: unknown
  manifestId?: string | null
  manifestUpdatedAt?: string | null
  manifestIntelligenceSource?: 'manifest_compatibility' | null
}

function readRecord(value: unknown): LeadManifestIntelligence | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as LeadManifestIntelligence
    : null
}

async function readLeadManifestIntelligence(leadId: string) {
  const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}`, { cache: 'no-store' })
  if (!response.ok) throw new Error('Seller intelligence is unavailable')
  const payload = await response.json() as LeadIntelligenceResponse
  return {
    manifest: readRecord(payload.manifest),
    manifestId: payload.manifestId ?? null,
    updatedAt: payload.manifestUpdatedAt ?? null,
    source: payload.manifestIntelligenceSource ?? null,
  }
}

export function useLeadManifestIntelligence(leadId: string) {
  const query = useQuery({
    queryKey: ['lead-manifest-intelligence', leadId],
    queryFn: () => readLeadManifestIntelligence(leadId),
    enabled: Boolean(leadId),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  })
  const refetch = query.refetch

  useEffect(() => {
    function refresh(event: Event) {
      const requestedLeadId = (event as CustomEvent<{ leadId?: string }>).detail?.leadId
      if (!requestedLeadId || requestedLeadId === leadId) void refetch()
    }
    window.addEventListener('crm:lead-refresh', refresh)
    return () => window.removeEventListener('crm:lead-refresh', refresh)
  }, [leadId, refetch])

  return {
    manifest: query.data?.manifest ?? null,
    manifestId: query.data?.manifestId ?? null,
    updatedAt: query.data?.updatedAt ?? null,
    source: query.data?.source ?? null,
    isLoading: query.isLoading,
    isError: query.isError,
  }
}
