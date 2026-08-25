'use client'

import { useEffect, useState } from 'react'
import type { DurableDialerQueueSubject } from '@/lib/dialer-session-client'
import type { ProspectingCampaignDetail } from '@/lib/prospecting/campaign-contract'

interface CampaignPreviewQueue {
  campaignId: string
  callerId: string | null
  error: string | null
  name: string | null
  subjects: DurableDialerQueueSubject[]
}

const EMPTY_SUBJECTS: DurableDialerQueueSubject[] = []

export function useCampaignPreviewQueue(campaignId: string | null) {
  const [result, setResult] = useState<CampaignPreviewQueue | null>(null)

  useEffect(() => {
    if (!campaignId) return
    let cancelled = false
    void fetch(`/api/prospecting/campaigns/${encodeURIComponent(campaignId)}`, { cache: 'no-store' })
      .then(async (response) => {
        const payload = await response.json().catch(() => null) as { campaign?: ProspectingCampaignDetail; error?: string } | null
        if (!response.ok || !payload?.campaign) throw new Error(payload?.error || 'Could not load the campaign preview.')
        const campaign = payload.campaign
        const subjects = campaign.members
          .filter((member) => member.status === 'active' && member.readyContactCount > 0)
          .map((member) => ({ kind: member.subjectKind, id: (member.subjectKind === 'lead' ? member.leadId : member.prospectId)!, leadId: member.leadId, prospectId: member.prospectId, campaignMemberId: member.id }))
          .filter((subject) => Boolean(subject.id))
        if (!cancelled) setResult({ campaignId, callerId: campaign.callerId, error: null, name: campaign.name, subjects })
      })
      .catch((error: unknown) => {
        if (!cancelled) setResult({ campaignId, callerId: null, error: error instanceof Error ? error.message : 'Could not load the campaign preview.', name: null, subjects: [] })
      })
    return () => { cancelled = true }
  }, [campaignId])

  const current = result?.campaignId === campaignId ? result : null
  return { callerId: current?.callerId ?? null, error: current?.error ?? null, loading: Boolean(campaignId && !current), name: current?.name ?? null, subjects: current?.subjects ?? EMPTY_SUBJECTS }
}
