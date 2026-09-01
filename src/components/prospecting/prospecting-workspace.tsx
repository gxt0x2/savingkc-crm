'use client'

import { useRouter } from 'next/navigation'
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react'
import { WorkspaceChrome } from '@/components/conversations/workspace-frame'
import { CampaignAudienceReview } from '@/components/prospecting/campaign-audience-review'
import { CampaignDashboard } from '@/components/prospecting/campaign-dashboard'
import { CampaignStudio, EMPTY_CAMPAIGN_FORM, type CampaignForm } from '@/components/prospecting/campaign-studio'
import { ProspectingSessionTakeoverDialog } from '@/components/prospecting/prospecting-session-takeover-dialog'
import { Icon } from '@/components/ui/icon'
import {
  DialerSessionClientError,
  takeOverDurableDialerSession,
  type DialerSessionControlSummary,
} from '@/lib/dialer-session-client'
import { parseStoredProspectingAudienceSelection, PROSPECTING_AUDIENCE_STORAGE_KEY, type ProspectingAudienceSelection } from '@/lib/prospecting/audience-handoff'
import { copyProspectingCampaignSetup, editableProspectingCampaignSetup, preferredProspectingDialerPickerCampaignId, type ProspectingCampaignDetail, type ProspectingCampaignSummary, type ProspectingDialerSessionSetup } from '@/lib/prospecting/campaign-contract'
import {
  dialerControllerHeaders,
  newDialerControlRequestId,
  publishDialerControlTaken,
} from '@/lib/telephony/dialer-controller-client'

type CampaignPage = { items: ProspectingCampaignSummary[]; pageInfo: { hasMore: boolean; nextCursor: string | null } }
const CAMPAIGN_LIVE_REFRESH_MS = 15000

async function jsonRequest<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({})) as T & {
    error?: string
    code?: string
    details?: DialerSessionControlSummary
  }
  if (!response.ok) throw new DialerSessionClientError(body.error || 'Request failed', body.code, body.details)
  return body
}

function freshCampaignForm(): CampaignForm {
  return { ...EMPTY_CAMPAIGN_FORM, steps: EMPTY_CAMPAIGN_FORM.steps.map((step) => ({ ...step })) }
}

export function ProspectingWorkspace({ openCreate = false, initialCampaignId = null, audienceMode = false }: { openCreate?: boolean; initialCampaignId?: string | null; audienceMode?: boolean }) {
  const router = useRouter()
  const [campaigns, setCampaigns] = useState<ProspectingCampaignSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<ProspectingCampaignDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [studioOpen, setStudioOpen] = useState(openCreate)
  const [audienceReviewOpen, setAudienceReviewOpen] = useState(audienceMode)
  const [pendingAudience, setPendingAudience] = useState<ProspectingAudienceSelection | null>(null)
  const [studioSourceName, setStudioSourceName] = useState<string | null>(null)
  const [editingCampaignId, setEditingCampaignId] = useState<string | null>(null)
  const [form, setForm] = useState<CampaignForm>(freshCampaignForm)
  const [saving, setSaving] = useState(false)
  const [actionPending, setActionPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [lastRefreshedAt, setLastRefreshedAt] = useState<string | null>(null)
  const [liveRefreshDelayed, setLiveRefreshDelayed] = useState(false)
  const [writesEnabled, setWritesEnabled] = useState(true)
  const [takeoverPrompt, setTakeoverPrompt] = useState<{
    summary: DialerSessionControlSummary
    setup: ProspectingDialerSessionSetup
  } | null>(null)
  const [takeoverBusy, setTakeoverBusy] = useState(false)
  const [takeoverError, setTakeoverError] = useState<string | null>(null)
  const selectedIdRef = useRef<string | null>(null)

  const loadCampaigns = useCallback(async () => {
    const page = await jsonRequest<CampaignPage>('/api/prospecting/campaigns?limit=50')
    setCampaigns(page.items)
    setSelectedId((current) => preferredProspectingDialerPickerCampaignId(page.items, current, initialCampaignId))
  }, [initialCampaignId])

  const loadDetail = useCallback(async (id: string, background = false) => {
    if (!background) setDetailLoading(true)
    try {
      const payload = await jsonRequest<{ campaign: ProspectingCampaignDetail; capabilities?: { writesEnabled?: boolean } }>(`/api/prospecting/campaigns/${id}`)
      if (selectedIdRef.current !== id) return null
      setDetail(payload.campaign)
      setWritesEnabled(payload.capabilities?.writesEnabled !== false)
      setCampaigns((current) => current.map((campaign) => campaign.id === id ? payload.campaign : campaign))
      setLastRefreshedAt(new Date().toISOString())
      setLiveRefreshDelayed(false)
      return payload.campaign
    } catch (loadError) {
      if (background) {
        setLiveRefreshDelayed(true)
        return null
      }
      throw loadError
    } finally {
      if (!background) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    try {
      setPendingAudience(parseStoredProspectingAudienceSelection(window.sessionStorage.getItem(PROSPECTING_AUDIENCE_STORAGE_KEY)))
    } catch { /* a blocked session store simply means no preselected audience */ }
    void loadCampaigns()
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Campaigns could not be loaded'))
      .finally(() => setLoading(false))
  }, [loadCampaigns])

  useEffect(() => {
    selectedIdRef.current = selectedId
    if (!selectedId) {
      setDetail(null)
      setWritesEnabled(true)
      setLastRefreshedAt(null)
      setLiveRefreshDelayed(false)
      return
    }
    void loadDetail(selectedId).catch((loadError) => setError(loadError instanceof Error ? loadError.message : 'Campaign details could not be loaded'))
  }, [loadDetail, selectedId])

  useEffect(() => {
    if (!selectedId || detail?.id !== selectedId || detail.status !== 'active' || studioOpen || audienceReviewOpen || actionPending) return
    let refreshRunning = false

    const refreshVisibleCampaign = async () => {
      if (refreshRunning || document.visibilityState !== 'visible') return
      refreshRunning = true
      try {
        await loadDetail(selectedId, true)
      } finally {
        refreshRunning = false
      }
    }

    const interval = window.setInterval(() => { void refreshVisibleCampaign() }, CAMPAIGN_LIVE_REFRESH_MS)
    const refreshOnVisible = () => { if (document.visibilityState === 'visible') void refreshVisibleCampaign() }
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [actionPending, audienceReviewOpen, detail?.id, detail?.status, loadDetail, selectedId, studioOpen])

  function openStudio() {
    setError(null)
    setNotice(null)
    setForm(freshCampaignForm())
    setStudioSourceName(null)
    setEditingCampaignId(null)
    setStudioOpen(true)
  }

  function editCampaign(campaign: ProspectingCampaignDetail) {
    setError(null)
    setNotice(null)
    window.sessionStorage.removeItem(PROSPECTING_AUDIENCE_STORAGE_KEY)
    setPendingAudience(null)
    const setup = editableProspectingCampaignSetup(campaign)
    setForm({ ...setup, callerId: setup.callerId || '', fromPhone: setup.fromPhone || '' })
    setStudioSourceName(null)
    setEditingCampaignId(campaign.id)
    setAudienceReviewOpen(false)
    setStudioOpen(true)
  }

  function duplicateCampaign(campaign: ProspectingCampaignDetail) {
    setError(null)
    setNotice(null)
    window.sessionStorage.removeItem(PROSPECTING_AUDIENCE_STORAGE_KEY)
    setPendingAudience(null)
    const copy = copyProspectingCampaignSetup(campaign)
    setForm({ ...copy, callerId: copy.callerId || '', fromPhone: copy.fromPhone || '' })
    setStudioSourceName(campaign.name)
    setEditingCampaignId(null)
    setAudienceReviewOpen(false)
    setStudioOpen(true)
  }

  function closeBuilder() {
    if (pendingAudience) {
      window.sessionStorage.removeItem(PROSPECTING_AUDIENCE_STORAGE_KEY)
      setPendingAudience(null)
    }
    setStudioOpen(false)
    setStudioSourceName(null)
    setEditingCampaignId(null)
    setAudienceReviewOpen(false)
    if (initialCampaignId) window.history.replaceState(null, '', `/prospecting?campaign=${encodeURIComponent(initialCampaignId)}`)
  }

  async function createCampaign(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      if (editingCampaignId) {
        const updated = await jsonRequest<{ campaign: ProspectingCampaignDetail }>(`/api/prospecting/campaigns/${editingCampaignId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            setup: {
              ...form,
              defaultTimezone: 'America/Chicago',
              steps: form.kind === 'sms' ? form.steps : [],
            },
          }),
        })
        setStudioOpen(false)
        setEditingCampaignId(null)
        setForm(freshCampaignForm())
        setNotice(`${updated.campaign.name} was updated and remains a draft.`)
        await Promise.all([loadCampaigns(), loadDetail(updated.campaign.id)])
        return
      }
      const created = await jsonRequest<{ campaign: ProspectingCampaignDetail }>('/api/prospecting/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          defaultTimezone: 'America/Chicago',
          steps: form.kind === 'sms' ? form.steps : [],
        }),
      })
      if (pendingAudience) {
        const memberResult = await jsonRequest<{ enrollment: { eligible: number; suppressed: number; missing: number } }>(`/api/prospecting/campaigns/${created.campaign.id}/members`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ selection: pendingAudience }),
        })
        setNotice(`${memberResult.enrollment.eligible} ready; ${memberResult.enrollment.suppressed} safely suppressed; ${memberResult.enrollment.missing} missing a usable phone.`)
        window.sessionStorage.removeItem(PROSPECTING_AUDIENCE_STORAGE_KEY)
        setPendingAudience(null)
      } else {
        setNotice(`${created.campaign.name} is a draft. Add an audience, review it, then activate when ready.`)
      }
      setStudioOpen(false)
      setStudioSourceName(null)
      setForm(freshCampaignForm())
      setSelectedId(created.campaign.id)
      window.history.replaceState(null, '', `/prospecting?campaign=${encodeURIComponent(created.campaign.id)}`)
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
        body: JSON.stringify({ status, confirmed: status === 'active' }),
      })
      await Promise.all([loadCampaigns(), loadDetail(detail.id)])
    } catch (transitionError) {
      setError(transitionError instanceof Error ? transitionError.message : 'Campaign status could not be changed')
    } finally {
      setActionPending(false)
    }
  }

  async function enrollSelectedIntoCurrentCampaign() {
    if (!detail || !pendingAudience || actionPending) return
    setActionPending(true)
    setError(null)
    try {
      const result = await jsonRequest<{ enrollment: { eligible: number; suppressed: number; missing: number } }>(`/api/prospecting/campaigns/${detail.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selection: pendingAudience }),
      })
      window.sessionStorage.removeItem(PROSPECTING_AUDIENCE_STORAGE_KEY)
      setPendingAudience(null)
      setStudioOpen(false)
      setAudienceReviewOpen(false)
      setNotice(`${result.enrollment.eligible} ready; ${result.enrollment.suppressed} safely suppressed; ${result.enrollment.missing} missing a usable phone.`)
      window.history.replaceState(null, '', `/prospecting?campaign=${encodeURIComponent(detail.id)}`)
      await loadDetail(detail.id)
    } catch (enrollmentError) {
      setError(enrollmentError instanceof Error ? enrollmentError.message : 'Audience could not be added')
    } finally {
      setActionPending(false)
    }
  }

  function navigateToDialerSession(input: {
    session: { id: string; status?: string; settingsSnapshot?: Record<string, unknown> }
    campaignId: string
    campaignName: string
    setup: ProspectingDialerSessionSetup
    continued?: boolean
    controlGeneration?: number
  }) {
    const ringCount = typeof input.session.settingsSnapshot?.ringCount === 'number'
      ? input.session.settingsSnapshot.ringCount
      : input.setup.ringCount
    const query = new URLSearchParams({
      session_id: input.session.id,
      campaign: input.campaignId,
      queue_label: input.campaignName,
      ring_count: String(ringCount),
      return_to: `/prospecting?campaign=${encodeURIComponent(input.campaignId)}`,
    })
    if (input.session.status !== 'paused') {
      window.sessionStorage.setItem(`savingkc:dialer-autostart:${input.session.id}`, '1')
    }
    if (input.continued && Number.isInteger(input.controlGeneration) && input.controlGeneration! >= 0) {
      publishDialerControlTaken(input.session.id, input.controlGeneration!)
    }
    router.push(`/prospecting?${query.toString()}`)
  }

  async function launchDialer(setup: ProspectingDialerSessionSetup) {
    if (!detail || actionPending) return
    if (!writesEnabled) {
      const query = new URLSearchParams({
        preview_campaign: detail.id,
        campaign: detail.id,
        queue_label: detail.name,
        caller_id: setup.callerIds[0] || '',
        caller_mode: setup.callerMode,
        rotation_numbers: setup.callerIds.join(','),
        rotation_every: '1',
        start_behavior: setup.startBehavior,
        ring_count: String(setup.ringCount),
        return_to: `/prospecting?campaign=${encodeURIComponent(detail.id)}`,
      })
      if (setup.notDialedHours !== null) query.set('not_dialed_hours', String(setup.notDialedHours))
      if (setup.notContactedHours !== null) query.set('not_contacted_hours', String(setup.notContactedHours))
      router.push(`/prospecting?${query.toString()}`)
      return
    }
    setActionPending(true)
    setError(null)
    try {
      const result = await jsonRequest<{ session: { id: string; status?: string; settingsSnapshot?: Record<string, unknown> } }>(`/api/prospecting/campaigns/${detail.id}/launch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...await dialerControllerHeaders() },
        body: JSON.stringify(setup),
      })
      setTakeoverPrompt(null)
      navigateToDialerSession({
        session: result.session,
        campaignId: detail.id,
        campaignName: detail.name,
        setup,
        continued: false,
      })
    } catch (launchError) {
      if (launchError instanceof DialerSessionClientError && launchError.details && [
        'session_control_conflict',
        'session_control_changed',
        'session_takeover_operation_in_progress',
        'another_dialer_session_open',
      ].includes(launchError.code || '')) {
        setTakeoverPrompt({ summary: launchError.details, setup })
        setTakeoverError(
          launchError.code === 'session_control_conflict' || launchError.code === 'another_dialer_session_open'
            ? null
            : launchError.message,
        )
        setActionPending(false)
        return
      }
      setError(launchError instanceof Error ? launchError.message : 'Dialer session could not start')
      setActionPending(false)
    }
  }

  async function confirmTakeover() {
    if (!takeoverPrompt || !detail || takeoverBusy) return
    setTakeoverBusy(true)
    setTakeoverError(null)
    const requestId = newDialerControlRequestId()
    try {
      const result = await takeOverDurableDialerSession({
        sessionId: takeoverPrompt.summary.sessionId,
        expectedGeneration: takeoverPrompt.summary.generation,
        requestId,
      })
      setTakeoverPrompt(null)
      navigateToDialerSession({
        session: result.session,
        campaignId: takeoverPrompt.summary.campaignId || detail.id,
        campaignName: takeoverPrompt.summary.campaignName,
        setup: takeoverPrompt.setup,
        continued: true,
        controlGeneration: Number(result.control.generation),
      })
    } catch (takeoverFailure) {
      if (takeoverFailure instanceof DialerSessionClientError && takeoverFailure.details) {
        setTakeoverPrompt((current) => current ? { ...current, summary: takeoverFailure.details! } : current)
      }
      setTakeoverError(takeoverFailure instanceof Error ? takeoverFailure.message : 'Dialing control could not be transferred.')
    } finally {
      setTakeoverBusy(false)
      setActionPending(false)
    }
  }

  const commandBar = (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <h1 className="min-w-0 truncate text-xl font-black text-[var(--crm-ink)]">{audienceReviewOpen ? 'Audience review' : studioOpen ? 'Campaign studio' : detail?.kind === 'sms' ? 'Seller outreach' : 'Seller calling'}</h1>
      {studioOpen || audienceReviewOpen ? <button type="button" onClick={closeBuilder} className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-black"><Icon name="close" />Exit {audienceReviewOpen ? 'review' : 'studio'}</button> : null}
    </div>
  )

  return <>
    <WorkspaceChrome commandBar={commandBar} />
    {takeoverPrompt ? <ProspectingSessionTakeoverDialog
      summary={takeoverPrompt.summary}
      selectedCampaignId={detail?.id}
      selectedCampaignName={detail?.name}
      busy={takeoverBusy}
      error={takeoverError}
      onCancel={() => {
        setTakeoverPrompt(null)
        setTakeoverError(null)
        setActionPending(false)
      }}
      onContinue={() => { void confirmTakeover() }}
    /> : null}
    {error || notice ? <div className="bg-[var(--crm-canvas)] px-3 pt-3 sm:px-5 lg:px-7"><div className={`mx-auto max-w-[1540px] rounded-xl border px-4 py-3 text-sm font-bold ${error ? 'border-[var(--crm-danger)]/30 bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'border-[var(--crm-success)]/30 bg-[var(--crm-success-soft)] text-[var(--crm-success)]'}`} role={error ? 'alert' : 'status'}>{error || notice}</div></div> : null}
    {audienceReviewOpen ? <CampaignAudienceReview campaign={detail} pendingCount={pendingAudience?.count ?? 0} saving={actionPending} onConfirm={() => void enrollSelectedIntoCurrentCampaign()} onCancel={closeBuilder} /> : studioOpen ? <CampaignStudio
      form={form}
      pendingAudienceCount={pendingAudience?.count ?? 0}
      saving={saving}
      sourceCampaignName={studioSourceName}
      editingCampaignName={editingCampaignId ? detail?.name : null}
      editingAudienceCount={editingCampaignId ? detail?.stats.total : 0}
      existingCampaignName={detail?.name}
      canAddToExisting={Boolean(detail && ['draft', 'paused'].includes(detail.status))}
      onChange={setForm}
      onCancel={closeBuilder}
      onCreate={createCampaign}
      onAddToExisting={() => void enrollSelectedIntoCurrentCampaign()}
    /> : <CampaignDashboard
      campaigns={campaigns}
      selectedId={selectedId}
      detail={detail}
      loading={loading}
      detailLoading={detailLoading}
      actionPending={actionPending}
      lastRefreshedAt={lastRefreshedAt}
      liveRefreshDelayed={liveRefreshDelayed}
      writesEnabled={writesEnabled}
      onSelect={setSelectedId}
      onCreate={openStudio}
      onDuplicate={duplicateCampaign}
      onEdit={editCampaign}
      onTransition={(status) => void transition(status)}
      onLaunchDialer={(setup) => void launchDialer(setup)}
      onAudienceChanged={detail ? async () => { await loadDetail(detail.id) } : undefined}
    />}
  </>
}
