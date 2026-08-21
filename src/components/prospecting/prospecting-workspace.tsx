'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { CampaignDashboard } from '@/components/prospecting/campaign-dashboard'
import { CampaignStudio, EMPTY_CAMPAIGN_FORM, type CampaignForm } from '@/components/prospecting/campaign-studio'
import { Icon } from '@/components/ui/icon'
import type { ProspectingCampaignDetail, ProspectingCampaignSummary } from '@/lib/prospecting/campaign-contract'

const AUDIENCE_KEY = 'savingkc-prospecting-audience-v1'

type CampaignPage = { items: ProspectingCampaignSummary[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Request failed')
  return body
}

function freshCampaignForm(): CampaignForm {
  return { ...EMPTY_CAMPAIGN_FORM, steps: EMPTY_CAMPAIGN_FORM.steps.map((step) => ({ ...step })) }
}

export function ProspectingWorkspace({ openCreate = false }: { openCreate?: boolean }) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<ProspectingCampaignSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProspectingCampaignDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [studioOpen, setStudioOpen] = useState(openCreate)
  const [pendingLeadIds, setPendingLeadIds] = useState<string[]>([])
  const [form, setForm] = useState<CampaignForm>(freshCampaignForm)
  const [saving, setSaving] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    const page = await jsonRequest<CampaignPage>('/api/prospecting/campaigns?limit=50')
    setCampaigns(page.items)
    setSelectedId((current) => current || page.items[0]?.id || null)
  }, [])

  const loadDetail = useCallback(async (id: string) => {
    setDetailLoading(true)
    try {
      const payload = await jsonRequest<{ campaign: ProspectingCampaignDetail }>(`/api/prospecting/campaigns/${id}`)
      setDetail(payload.campaign)
    } finally {
      setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(AUDIENCE_KEY)
      const parsed = stored ? JSON.parse(stored) : []
      if (Array.isArray(parsed)) setPendingLeadIds(parsed.filter((value): value is string => typeof value === 'string'))
    } catch { /* a blocked session store simply means no preselected audience */ }
    void loadCampaigns()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Campaigns could not be loaded'))
      .finally(() => setLoading(false))
  }, [loadCampaigns])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    void loadDetail(selectedId).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Campaign details could not be loaded'))
  }, [loadDetail, selectedId])

  function openStudio() {
    setError(null)
    setNotice(null)
    setForm(freshCampaignForm())
    setStudioOpen(true)
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const created = await jsonRequest<{ campaign: ProspectingCampaignDetail }>('/api/prospecting/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          defaultTimezone: 'America/Chicago',
          steps: form.kind === 'sms' ? form.steps : [],
        }),
      })
      if (pendingLeadIds.length > 0) {
        const memberResult = await jsonRequest<{ enrollment: { eligible: number; suppressed: number; missing: number } }>(`/api/prospecting/campaigns/${created.campaign.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ leadIds: pendingLeadIds }),
        })
        setNotice(`${memberResult.enrollment.eligible} ready; ${memberResult.enrollment.suppressed} safely suppressed; ${memberResult.enrollment.missing} missing a usable phone.`)
        window.sessionStorage.removeItem(AUDIENCE_KEY)
        setPendingLeadIds([])
      } else {
        setNotice(`${created.campaign.name} is a draft. Add an audience, review it, then activate when ready.`)
      }
      setStudioOpen(false)
      setForm(freshCampaignForm())
      setSelectedId(created.campaign.id)
      await Promise.all([loadCampaigns(), loadDetail(created.campaign.id)])
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Campaign could not be created')
    } finally {
      setSaving(false)
    }
  }

  async function transition(status: 'active' | 'paused' | 'archived') {
    if (!detail || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      await jsonRequest(`/api/prospecting/campaigns/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      await Promise.all([loadCampaigns(), loadDetail(detail.id)])
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : 'Campaign status could not be changed')
    } finally {
      setActionPending(false)
    }
  }

  async function enrollSelectedIntoCurrentCampaign() {
    if (!detail || pendingLeadIds.length < 1 || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      const result = await jsonRequest<{ enrollment: { eligible: number; suppressed: number; missing: number } }>(`/api/prospecting/campaigns/${detail.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadIds: pendingLeadIds }),
      })
      window.sessionStorage.removeItem(AUDIENCE_KEY)
      setPendingLeadIds([])
      setStudioOpen(false)
      setNotice(`${result.enrollment.eligible} ready; ${result.enrollment.suppressed} safely suppressed; ${result.enrollment.missing} missing a usable phone.`)
      await loadDetail(detail.id)
    } catch (enrollmentError) {
      setError(enrollmentError instanceof Error ? enrollmentError.message : 'Audience could not be added')
    } finally {
      setActionPending(false)
    }
  }

  async function launchDialer() {
    if (!detail || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      const result = await jsonRequest<{ session: { id: string } }>(`/api/prospecting/campaigns/${detail.id}/launch`, { method: 'POST' })
      router.push(`/dialer?session_id=${result.session.id}`)
    } catch (launchError) {
      setError(launchError instanceof Error ? launchError.message : 'Dialer session could not start')
      setActionPending(false)
    }
  }

  const commandBar = (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="min-w-0"><p className="crm-eyebrow">Prospecting</p><h1 className="truncate text-xl font-black text-[var(--crm-ink)]">{studioOpen ? 'Campaign studio' : 'Campaign command center'}</h1></div>
      {studioOpen ? <button type="button" onClick={() => setStudioOpen(false)} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black"><Icon name="close" />Exit studio</button> : <button type="button" onClick={openStudio} className="crm-primary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black"><Icon name="add" />Build campaign</button>}
    </div>
  )

  return <>
    <WorkspaceChrome commandBar={commandBar} />
    {error || notice ? <div className="bg-[var(--crm-canvas)] px-3 pt-3 sm:px-5 lg:px-7"><div className={`mx-auto max-w-[1540px] rounded-xl border px-4 py-3 text-sm font-bold ${error ? 'border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] text-[var(--crm-success)]'}`} role={error ? 'alert' : 'status'}>{error || notice}</div></div> : null}
    {studioOpen ? <CampaignStudio
      form={form}
      pendingLeadIds={pendingLeadIds}
      saving={saving}
      existingCampaignName={detail?.name}
      canAddToExisting={Boolean(detail && ['draft', 'paused'].includes(detail.status))}
      onChange={setForm}
      onCancel={() => setStudioOpen(false)}
      onCreate={createCampaign}
      onAddToExisting={() => void enrollSelectedIntoCurrentCampaign()}
    /> : <CampaignDashboard
      campaigns={campaigns}
      selectedId={selectedId}
      detail={detail}
      loading={loading}
      detailLoading={detailLoading}
      actionPending={actionPending}
      onSelect={setSelectedId}
      onCreate={openStudio}
      onTransition={(status) => void transition(status)}
      onLaunchDialer={() => void launchDialer()}
    />}
  </>
}
