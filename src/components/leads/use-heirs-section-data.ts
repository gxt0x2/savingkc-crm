'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Heir } from '@/lib/heir-dialer-queue'

interface UseHeirsSectionDataArgs {
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
}

interface HeirsResponse {
  heirs?: Heir[]
  last_skip_traced_at?: string | null
}

export function useHeirsSectionData({ leadId, prospectId, campaignMemberId }: UseHeirsSectionDataArgs) {
  const [heirs, setHeirs] = useState<Heir[]>([])
  const [loading, setLoading] = useState(true)
  const [lastTracedAt, setLastTracedAt] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const subjectKey = leadId ? `lead:${leadId}` : prospectId ? `prospect:${prospectId}` : null

  const requestHeirs = useCallback(async () => {
    if (!subjectKey) throw new Error('Lead or source Prospect context is required')
    const query = leadId
      ? `lead_id=${encodeURIComponent(leadId)}`
      : `prospect_id=${encodeURIComponent(prospectId!)}`
    const campaignQuery = campaignMemberId
      ? `&campaign_member_id=${encodeURIComponent(campaignMemberId)}`
      : ''
    const response = await fetch(`/api/heirs?${query}${campaignQuery}`)
    const data = await response.json() as HeirsResponse & { error?: string }
    if (!response.ok) throw new Error(data.error || 'Failed to load heirs')
    return data
  }, [campaignMemberId, leadId, prospectId, subjectKey])

  const applyHeirs = useCallback((data: HeirsResponse) => {
    setHeirs(data.heirs || [])
    setLastTracedAt(data.last_skip_traced_at || null)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      applyHeirs(await requestHeirs())
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load heirs')
    } finally {
      setLoading(false)
    }
  }, [applyHeirs, requestHeirs])

  useEffect(() => {
    let cancelled = false
    void requestHeirs()
      .then((data) => { if (!cancelled) applyHeirs(data) })
      .catch((loadError) => {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : 'Failed to load heirs')
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [applyHeirs, requestHeirs])

  return { heirs, loading, lastTracedAt, error, setError, load, subjectKey }
}
