'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '@/components/ui/icon'
import { ANDON_KIND_LABELS, ANDON_STATUSES, type AndonIssueKind } from '@/lib/andon'
import { formatAndonAttachmentBytes, type AndonAttachmentRow } from '@/lib/andon-attachments'

type RangePreset = 'today' | '7d' | '30d' | 'all' | 'custom'
type QueueFilter = 'active' | 'completed' | 'all' | string

interface AndonItem {
  id: string
  type: string
  issue_kind: AndonIssueKind
  department: string
  category: string
  description: string
  five_whys: string[]
  priority: string
  status: string
  created_at: string
  updated_at?: string | null
  resolved_at?: string | null
  record_id?: string | null
  record_type?: 'lead' | 'property' | null
  record_url?: string | null
  assignee?: string | null
  estimated_resolution_at?: string | null
  agent_name?: string | null
  page_url?: string | null
  source: 'feedback' | 'error_log'
}

interface AndonResponse {
  items: AndonItem[]
  total: number
  warnings?: string[]
  storage_ready?: boolean
  automatic_error_log_ready?: boolean
}

interface AndonAttachmentsResponse {
  attachments: AndonAttachmentRow[]
}

const EMPTY_ANDONS: AndonItem[] = []
const RANGE_LABELS: Record<RangePreset, string> = { today: 'Today', '7d': 'Last 7 days', '30d': 'Last 30 days', all: 'All time', custom: 'Custom range' }
const KIND_TONES: Record<AndonIssueKind, { icon: string; color: string; soft: string }> = {
  process: { icon: 'account_tree', color: 'var(--crm-violet)', soft: 'var(--crm-violet-soft)' },
  system: { icon: 'bug_report', color: 'var(--crm-danger)', soft: 'var(--crm-danger-soft)' },
  data: { icon: 'database', color: 'var(--crm-info)', soft: 'var(--crm-info-soft)' },
  improvement: { icon: 'lightbulb', color: 'var(--crm-success)', soft: 'var(--crm-success-soft)' },
  ai_glitch: { icon: 'smart_toy', color: '#7c3aed', soft: '#f2ecff' },
}

function localDateInput(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function defaultCustomDates() {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 29)
  return { start: localDateInput(start), end: localDateInput(end) }
}

function rangeParams(preset: RangePreset, customStart: string, customEnd: string) {
  if (preset === 'all') return new URLSearchParams()
  const end = new Date()
  const start = new Date(end)
  if (preset === 'today') start.setHours(0, 0, 0, 0)
  if (preset === '7d') start.setDate(start.getDate() - 6)
  if (preset === '30d') start.setDate(start.getDate() - 29)
  if (preset === 'custom') {
    start.setTime(new Date(`${customStart}T00:00:00`).getTime())
    end.setTime(new Date(`${customEnd}T23:59:59.999`).getTime())
  }
  return new URLSearchParams({ from: start.toISOString(), to: end.toISOString() })
}

function useAndons(preset: RangePreset, customStart: string, customEnd: string) {
  return useQuery<AndonResponse>({
    queryKey: ['andon-log', preset, customStart, customEnd],
    queryFn: async () => {
      const response = await fetch(`/api/feedback/log?${rangeParams(preset, customStart, customEnd)}`, { cache: 'no-store' })
      if (!response.ok) throw new Error('The Andon dashboard could not load.')
      return response.json() as Promise<AndonResponse>
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  })
}

export function AndonDashboard() {
  const defaults = defaultCustomDates()
  const [preset, setPreset] = useState<RangePreset>('30d')
  const [customStart, setCustomStart] = useState(defaults.start)
  const [customEnd, setCustomEnd] = useState(defaults.end)
  const [kindFilter, setKindFilter] = useState<'all' | AndonIssueKind>('all')
  const [statusFilter, setStatusFilter] = useState<QueueFilter>('active')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draftWhys, setDraftWhys] = useState<string[]>(['', '', '', '', ''])
  const [draftAssignee, setDraftAssignee] = useState('')
  const [draftEta, setDraftEta] = useState('')
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState('')
  const { data, error, isLoading, isFetching, refetch } = useAndons(preset, customStart, customEnd)
  const items = data?.items ?? EMPTY_ANDONS
  const selected = items.find((item) => item.id === selectedId) ?? null
  const attachmentsQuery = useQuery<AndonAttachmentsResponse>({
    queryKey: ['andon-attachments', selectedId],
    queryFn: async () => {
      const response = await fetch(`/api/feedback/${selectedId}/attachments`, { cache: 'no-store' })
      if (!response.ok) throw new Error('Supporting evidence could not be loaded.')
      return response.json() as Promise<AndonAttachmentsResponse>
    },
    enabled: Boolean(selectedId && selected?.source === 'feedback'),
    staleTime: 15_000,
  })

  const filteredItems = useMemo(() => items.filter((item) => {
    if (kindFilter !== 'all' && item.issue_kind !== kindFilter) return false
    if (statusFilter === 'active' && ['resolved', 'closed'].includes(item.status)) return false
    if (statusFilter === 'completed' && !['resolved', 'closed'].includes(item.status)) return false
    if (!['active', 'completed', 'all'].includes(statusFilter) && item.status !== statusFilter) return false
    if (search.trim()) {
      const haystack = [item.description, item.department, item.category, item.agent_name, item.assignee, item.record_id].join(' ').toLowerCase()
      if (!haystack.includes(search.trim().toLowerCase())) return false
    }
    return true
  }), [items, kindFilter, search, statusFilter])

  const active = items.filter((item) => !['resolved', 'closed'].includes(item.status))
  const completed = items.filter((item) => ['resolved', 'closed'].includes(item.status))
  const completedRootCauses = items.filter((item) => item.five_whys.filter(Boolean).length === 5).length
  const averageResolutionHours = completed.length > 0
    ? Math.round(completed.reduce((sum, item) => sum + Math.max(0, new Date(item.resolved_at ?? item.updated_at ?? item.created_at).getTime() - new Date(item.created_at).getTime()), 0) / completed.length / 3_600_000)
    : null
  const kindCounts = Object.keys(ANDON_KIND_LABELS).map((kind) => ({ kind: kind as AndonIssueKind, count: items.filter((item) => item.issue_kind === kind).length }))
  const departmentCounts = [...items.reduce((counts, item) => counts.set(item.department, (counts.get(item.department) ?? 0) + 1), new Map<string, number>()).entries()]
    .sort((left, right) => right[1] - left[1]).slice(0, 6)
  const maxDepartment = Math.max(...departmentCounts.map(([, count]) => count), 1)

  function openItem(item: AndonItem) {
    setSelectedId(item.id)
    setDraftWhys(Array.from({ length: 5 }, (_, index) => item.five_whys?.[index] ?? ''))
    setDraftAssignee(item.assignee ?? '')
    setDraftEta(item.estimated_resolution_at ? localDateInput(new Date(item.estimated_resolution_at)) : '')
    setActionError('')
  }

  async function updateItem(status: string, options: { includeWhys?: boolean; includeOwnership?: boolean; closeAfter?: boolean } = {}) {
    if (!selected) return
    setSaving(true)
    setActionError('')
    try {
      const response = await fetch('/api/feedback/update-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: selected.id,
          source: selected.source,
          status,
          issue_kind: selected.issue_kind,
          description: selected.description,
          five_whys: options.includeWhys ? draftWhys : undefined,
          assignee: options.includeOwnership ? draftAssignee : undefined,
          estimated_resolution_at: options.includeOwnership ? draftEta : undefined,
        }),
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null
        throw new Error(payload?.error || 'The Andon could not be updated.')
      }
      await refetch()
      if (options.closeAfter) setSelectedId(null)
    } catch (updateError) {
      setActionError(updateError instanceof Error ? updateError.message : 'The Andon could not be updated.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="mx-auto w-full max-w-[1720px] space-y-3 px-3 py-4 pb-24 sm:px-5 lg:px-6">
      <header className="crm-panel flex flex-col gap-4 rounded-2xl px-5 py-4 xl:flex-row xl:items-center xl:justify-between">
        <div><p className="crm-eyebrow">SavingKC Andon · Continuous improvement</p><h1 className="mt-1 text-[25px] font-black tracking-[-0.035em]">Issue Log</h1><p className="mt-0.5 max-w-3xl text-xs font-medium text-[var(--crm-text-muted)]">One live Andon queue for process, system, data, and AI issues - from first signal through root cause and verified resolution.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/dashboard" className="crm-secondary-button inline-flex h-10 items-center gap-2 rounded-xl px-3 text-xs font-black"><Icon name="space_dashboard" />CEO overview</Link>
          <label className="flex h-10 items-center gap-2 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] px-3 shadow-sm"><Icon name="date_range" className="text-[19px] text-[var(--crm-brand)]" /><select aria-label="Andon date range" value={preset} onChange={(event) => setPreset(event.target.value as RangePreset)} className="bg-transparent text-xs font-black outline-none">{Object.entries(RANGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {preset === 'custom' ? <><input aria-label="Andon start date" type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className="crm-field h-10 rounded-xl px-3 text-xs font-bold" /><input aria-label="Andon end date" type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} className="crm-field h-10 rounded-xl px-3 text-xs font-bold" /></> : null}
          <span className="inline-flex h-10 items-center gap-2 rounded-xl border border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] px-3 text-xs font-black text-[var(--crm-success)]"><span className={`h-2 w-2 rounded-full bg-[var(--crm-success)] ${isFetching ? 'animate-pulse' : ''}`} />Live queue</span>
        </div>
      </header>

      {error ? <Alert message={error.message} action={() => void refetch()} /> : null}
      {data?.warnings?.length ? <div role="status" className="crm-panel rounded-2xl border-[var(--crm-warning)]/30 px-5 py-3 text-xs font-bold text-[var(--crm-warning)]"><Icon name="warning_amber" className="mr-2 inline" />{data.warnings.join(' ')}</div> : null}

      <section aria-label="Andon operating metrics" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
        <Metric icon="warning" label="Open Andons" value={active.length} detail="Needs owner action" tone="danger" />
        <Metric icon="priority_high" label="Critical" value={items.filter((item) => item.priority === 'critical' && !['resolved', 'closed'].includes(item.status)).length} detail="Active critical impact" tone="coral" />
        <Metric icon="construction" label="In progress" value={items.filter((item) => ['acknowledged', 'in_progress', 'testing'].includes(item.status)).length} detail="Acknowledged through testing" tone="blue" />
        <Metric icon="fact_check" label="Root cause complete" value={`${completedRootCauses}/${items.length}`} detail="All five Whys recorded" tone="violet" />
        <Metric icon="timer" label="Avg. resolution" value={averageResolutionHours == null ? 'Not recorded' : `${averageResolutionHours}h`} detail={`${completed.length} resolved in range`} tone="green" />
      </section>

      <section className="grid gap-3 xl:grid-cols-[0.86fr_1.14fr]">
        <section className="crm-panel rounded-2xl p-4"><div className="mb-4"><p className="crm-eyebrow">Signal mix</p><h2 className="mt-1 text-base font-black">What is breaking good work?</h2></div><div className="grid grid-cols-2 gap-2 lg:grid-cols-5">{kindCounts.map(({ kind, count }) => { const tone = KIND_TONES[kind]; return <button key={kind} type="button" onClick={() => setKindFilter(kindFilter === kind ? 'all' : kind)} className={`rounded-xl border p-3 text-left transition-colors ${kindFilter === kind ? 'border-[var(--crm-brand)] ring-2 ring-[var(--crm-brand)]/10' : 'border-[var(--crm-border)]'}`}><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: tone.color, background: tone.soft }}><Icon name={tone.icon} /></span><strong className="mt-2 block text-xl font-black">{count}</strong><span className="text-xs font-bold text-[var(--crm-text-muted)]">{ANDON_KIND_LABELS[kind]}</span></button> })}</div></section>
        <section className="crm-panel rounded-2xl p-4"><div className="mb-4"><p className="crm-eyebrow">Work area concentration</p><h2 className="mt-1 text-base font-black">Where issues originate</h2></div>{departmentCounts.length > 0 ? <div className="space-y-3">{departmentCounts.map(([department, count]) => <div key={department} className="grid grid-cols-[150px_1fr_28px] items-center gap-3 text-xs"><strong className="truncate">{department}</strong><span className="h-2 overflow-hidden rounded-full bg-[var(--crm-surface-subtle)]"><span className="block h-full rounded-full bg-[var(--crm-info)]" style={{ width: `${Math.round(count / maxDepartment * 100)}%` }} /></span><strong className="text-right">{count}</strong></div>)}</div> : <EmptyState label="No Andons in this range" />}</section>
      </section>

      <section className="crm-panel overflow-hidden rounded-2xl">
        <header className="border-b border-[var(--crm-border)] px-4 py-3">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"><div><p className="crm-eyebrow">Operating queue</p><h2 className="mt-1 text-base font-black">Andons requiring review</h2></div><div className="flex flex-wrap gap-2"><label className="relative"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 text-[18px] text-[var(--crm-text-muted)]" /><input aria-label="Search Andons" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Andons..." className="crm-field h-10 w-56 rounded-xl pl-9 pr-3 text-xs font-semibold" /></label><select aria-label="Andon type filter" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as 'all' | AndonIssueKind)} className="crm-field h-10 rounded-xl px-3 text-xs font-bold"><option value="all">All issue types</option>{Object.entries(ANDON_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></div></div>
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Andon queue view"><QueueButton active={statusFilter === 'active'} onClick={() => setStatusFilter('active')}>Active queue <Count value={active.length} /></QueueButton><QueueButton active={statusFilter === 'completed'} onClick={() => setStatusFilter('completed')}>Resolved / closed <Count value={completed.length} /></QueueButton><QueueButton active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>All <Count value={items.length} /></QueueButton></div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1380px]">
            <thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-4 py-3 text-left">Issue</th><th className="px-4 py-3 text-left">Property / lead</th><th className="px-4 py-3 text-left">Work area</th><th className="px-4 py-3 text-left">Specific process</th><th className="px-4 py-3 text-left">Impact</th><th className="px-4 py-3 text-left">Assignee</th><th className="px-4 py-3 text-left">Target</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Raised</th><th className="px-4 py-3 text-left">By</th><th className="w-24" /></tr></thead>
            <tbody>{isLoading ? <tr><td colSpan={11} className="px-4 py-12 text-center text-sm font-semibold text-[var(--crm-text-muted)]">Loading live Andons…</td></tr> : filteredItems.length === 0 ? <tr><td colSpan={11}><EmptyState label={statusFilter === 'active' ? 'No active Andons' : statusFilter === 'completed' ? 'No resolved or closed Andons' : 'No Andons match these filters'} /></td></tr> : filteredItems.map((item) => <AndonRow key={`${item.source}-${item.id}`} item={item} onOpen={() => openItem(item)} />)}</tbody>
          </table>
        </div>
      </section>

      {selected ? <div className="fixed inset-0 z-[100] bg-black/45" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedId(null) }}><aside role="dialog" aria-modal="true" aria-labelledby="andon-detail-title" className="absolute inset-y-0 right-0 w-full max-w-xl overflow-y-auto border-l border-[var(--crm-border)] bg-[var(--crm-surface)] p-5 shadow-2xl">
        <header className="flex items-start justify-between gap-4"><div><p className="crm-eyebrow">{ANDON_KIND_LABELS[selected.issue_kind]} · {selected.department}</p><h2 id="andon-detail-title" className="mt-1 text-xl font-black">{selected.category}</h2><p className="mt-1 text-xs text-[var(--crm-text-muted)]">Raised {new Date(selected.created_at).toLocaleString()} by {selected.agent_name || 'System'}</p></div><button type="button" onClick={() => setSelectedId(null)} aria-label="Close Andon details" className="crm-icon-button grid h-9 w-9 place-items-center rounded-lg"><Icon name="close" /></button></header>
        <div className="mt-5 flex flex-wrap gap-2"><ImpactBadge priority={selected.priority} /><StatusBadge status={selected.status} />{selected.record_url ? <a href={selected.record_url} className="crm-secondary-button inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-black"><Icon name="open_in_new" />Open impacted {selected.record_type || 'record'}</a> : null}</div>
        <section className="mt-5 rounded-xl border border-[var(--crm-border)] p-4"><h3 className="text-xs font-black uppercase tracking-wider">What happened</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-6">{selected.description}</p></section>
        {selected.source === 'feedback' ? <AndonEvidence attachments={attachmentsQuery.data?.attachments ?? []} loading={attachmentsQuery.isLoading} error={attachmentsQuery.error?.message} /> : null}
        <section className="mt-3 rounded-xl border border-[var(--crm-border)] p-4"><div><h3 className="text-xs font-black uppercase tracking-wider">Ownership and target</h3><p className="mt-1 text-[11px] text-[var(--crm-text-muted)]">High and critical issues need a visible recovery target.</p></div><div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold">Assignee<input list="andon-assignees" aria-label="Andon assignee" value={draftAssignee} onChange={(event) => setDraftAssignee(event.target.value)} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-xs font-medium" placeholder="Unassigned" /><datalist id="andon-assignees"><option value="Ernest" /><option value="Casey" /><option value="Gertha" /><option value="Operations manager" /><option value="Developer" /></datalist></label><label className="text-xs font-bold">Estimated resolution date<input aria-label="Estimated resolution date" type="date" value={draftEta} onChange={(event) => setDraftEta(event.target.value)} className="crm-field mt-1 h-10 w-full rounded-lg px-3 text-xs font-medium" /></label></div>{['high', 'critical'].includes(selected.priority) && !draftEta ? <p className="mt-2 text-[11px] font-bold text-[var(--crm-danger)]">Set a target date so the affected team knows when work can safely resume.</p> : null}<button type="button" disabled={saving} onClick={() => void updateItem(selected.status, { includeOwnership: true })} className="crm-secondary-button mt-3 w-full rounded-lg px-3 py-2 text-xs font-black disabled:opacity-50">Save owner and target</button></section>
        <section className="mt-3 rounded-xl border border-[var(--crm-border)] p-4"><div className="flex items-center justify-between"><div><h3 className="text-xs font-black uppercase tracking-wider">Five Whys</h3><p className="mt-1 text-[11px] text-[var(--crm-text-muted)]">Complete the root-cause chain before resolution.</p></div><span className="rounded-full bg-[var(--crm-info-soft)] px-2 py-1 text-[10px] font-black text-[var(--crm-info)]">{draftWhys.filter(Boolean).length}/5</span></div><div className="mt-3 space-y-2">{draftWhys.map((why, index) => <label key={index} className="grid items-center gap-2 text-xs font-bold sm:grid-cols-[58px_1fr]"><span>Why {index + 1}</span><input value={why} onChange={(event) => setDraftWhys((current) => current.map((entry, entryIndex) => entryIndex === index ? event.target.value : entry))} className="crm-field h-10 rounded-lg px-3 text-xs font-medium" placeholder="Root cause not recorded" /></label>)}</div><button type="button" disabled={saving} onClick={() => void updateItem(selected.status, { includeWhys: true })} className="crm-secondary-button mt-3 w-full rounded-lg px-3 py-2 text-xs font-black">Save root-cause analysis</button></section>
        {!['resolved', 'closed'].includes(selected.status) ? <section className="mt-3 rounded-xl border border-[var(--crm-border)] p-4"><h3 className="text-xs font-black uppercase tracking-wider">Move through resolution</h3><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{(selected.source === 'error_log' ? ['open'] : ANDON_STATUSES.filter((status) => !['resolved', 'closed'].includes(status))).map((status) => <button key={status} type="button" disabled={saving || selected.status === status} onClick={() => void updateItem(status)} className={`rounded-lg border px-2 py-2 text-xs font-bold capitalize ${selected.status === status ? 'border-[var(--crm-info)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]' : 'border-[var(--crm-border)] hover:border-[var(--crm-border-strong)] disabled:opacity-60'}`}>{status.replaceAll('_', ' ')}</button>)}</div><button type="button" disabled={saving} onClick={() => void updateItem('resolved', { includeWhys: true, includeOwnership: true, closeAfter: true })} className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[var(--crm-success)] px-3 py-3 text-xs font-black text-white disabled:opacity-50"><Icon name="task_alt" />Resolve and clear from active queue</button></section> : <button type="button" disabled={saving} onClick={() => void updateItem('open', { closeAfter: true })} className="crm-secondary-button mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-3 text-xs font-black"><Icon name="restart_alt" />Reopen issue</button>}
        {actionError ? <div role="alert" className="mt-3 rounded-lg bg-[var(--crm-danger-soft)] px-3 py-2 text-xs font-bold text-[var(--crm-danger)]">{actionError}</div> : null}
      </aside></div> : null}
    </main>
  )
}

export function AndonEvidence({ attachments, loading, error }: { attachments: AndonAttachmentRow[]; loading: boolean; error?: string }) {
  if (loading) return <section className="mt-3 rounded-xl border border-[var(--crm-border)] p-4 text-xs font-semibold text-[var(--crm-text-muted)]">Loading attached evidence…</section>
  if (error) return <section role="status" className="mt-3 rounded-xl border border-[var(--crm-warning)]/30 p-4 text-xs font-semibold text-[var(--crm-warning)]">{error}</section>
  if (attachments.length === 0) return null

  return <section className="mt-3 rounded-xl border border-[var(--crm-border)] p-4"><div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-wider">Attached evidence</h3><span className="rounded-full bg-[var(--crm-info-soft)] px-2 py-1 text-[10px] font-black text-[var(--crm-info)]">{attachments.length}</span></div><div className="mt-3 space-y-3">{attachments.map((attachment) => {
    const previewUrl = `/api/feedback/attachments/${attachment.id}/download?preview=1`
    const downloadUrl = `/api/feedback/attachments/${attachment.id}/download`
    return <article key={attachment.id} className="overflow-hidden rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]">
      {attachment.kind === 'image' ? <a href={previewUrl} target="_blank" rel="noreferrer" className="block bg-black/5"><Image src={previewUrl} alt={attachment.filename} width={640} height={360} unoptimized className="max-h-72 w-full object-contain" /></a> : null}
      {attachment.kind === 'video' ? <video aria-label={`Video evidence ${attachment.filename}`} controls preload="metadata" className="max-h-72 w-full bg-black"><source src={previewUrl} type={attachment.mime_type || undefined} />Your browser cannot preview this video.</video> : null}
      {attachment.kind === 'audio' ? <div className="p-3"><audio aria-label={`Audio evidence ${attachment.filename}`} controls preload="metadata" className="w-full"><source src={previewUrl} type={attachment.mime_type || undefined} />Your browser cannot preview this audio.</audio></div> : null}
      <div className="flex items-center gap-2 border-t border-[var(--crm-border)] px-3 py-2 text-xs"><Icon name={attachment.kind === 'image' ? 'image' : attachment.kind === 'video' ? 'videocam' : attachment.kind === 'audio' ? 'audio_file' : 'description'} className="shrink-0 text-[var(--crm-info)]" /><span className="min-w-0 flex-1"><strong className="block truncate">{attachment.filename}</strong><span className="text-[10px] text-[var(--crm-text-muted)]">{formatAndonAttachmentBytes(attachment.byte_size)}</span></span><a href={attachment.kind === 'file' ? downloadUrl : previewUrl} target="_blank" rel="noreferrer" className="crm-secondary-button inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-black"><Icon name={attachment.kind === 'file' ? 'download' : 'open_in_new'} className="text-sm" />{attachment.kind === 'file' ? 'Download' : 'Open'}</a></div>
    </article>
  })}</div></section>
}

function AndonRow({ item, onOpen }: { item: AndonItem; onOpen: () => void }) {
  const tone = KIND_TONES[item.issue_kind]
  const targetMissing = ['high', 'critical'].includes(item.priority) && !item.estimated_resolution_at && !['resolved', 'closed'].includes(item.status)
  return <tr className="cursor-pointer border-t border-[var(--crm-border)] text-xs hover:bg-[var(--crm-surface-subtle)]" onClick={onOpen}><td className="max-w-[320px] px-4 py-3"><div className="flex items-start gap-2"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ color: tone.color, background: tone.soft }}><Icon name={tone.icon} /></span><div className="min-w-0"><strong className="block">{ANDON_KIND_LABELS[item.issue_kind]}</strong><span className="mt-0.5 block truncate text-[var(--crm-text-muted)]">{item.description}</span></div></div></td><td className="px-4 py-3">{item.record_url ? <a href={item.record_url} onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 font-black text-[var(--crm-info)] hover:underline"><Icon name={item.record_type === 'property' ? 'home' : 'person'} className="text-sm" />{item.record_id ? shortRecordId(item.record_id) : 'Open record'}</a> : <span className="text-[var(--crm-text-muted)]">Not linked</span>}</td><td className="px-4 py-3 font-bold">{item.department}</td><td className="px-4 py-3 text-[var(--crm-text-muted)]">{item.category}</td><td className="px-4 py-3"><ImpactBadge priority={item.priority} /></td><td className="px-4 py-3 font-bold">{item.assignee || 'Unassigned'}</td><td className={`px-4 py-3 font-bold ${targetMissing ? 'text-[var(--crm-danger)]' : 'text-[var(--crm-text-muted)]'}`}>{item.estimated_resolution_at ? new Date(item.estimated_resolution_at).toLocaleDateString() : targetMissing ? 'Target required' : '—'}</td><td className="px-4 py-3"><StatusBadge status={item.status} /></td><td className="px-4 py-3 text-[var(--crm-text-muted)]">{new Date(item.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td><td className="px-4 py-3">{item.agent_name || 'System'}</td><td className="px-3 py-3"><button type="button" onClick={(event) => { event.stopPropagation(); onOpen() }} className="crm-secondary-button rounded-lg px-3 py-2 text-[10px] font-black">Review</button></td></tr>
}

function shortRecordId(id: string) { return id.length > 14 ? `${id.slice(0, 8)}…` : id }
function Count({ value }: { value: number }) { return <span className="ml-1 rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-[10px]">{value}</span> }
function QueueButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) { return <button type="button" onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-black ${active ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)] ring-1 ring-[var(--crm-brand-border)]' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]'}`}>{children}</button> }
function Alert({ message, action }: { message: string; action: () => void }) { return <div role="alert" className="crm-panel flex items-center justify-between rounded-2xl border-[var(--crm-danger)]/30 px-5 py-4 text-sm font-bold text-[var(--crm-danger)]"><span>{message}</span><button type="button" onClick={action} className="crm-secondary-button rounded-lg px-3 py-2 text-xs">Retry</button></div> }
function Metric({ icon, label, value, detail, tone }: { icon: string; label: string; value: string | number; detail: string; tone: 'danger' | 'coral' | 'blue' | 'violet' | 'green' }) { const colors = { danger: ['var(--crm-danger)', 'var(--crm-danger-soft)'], coral: ['#f05a28', '#ffebe4'], blue: ['var(--crm-info)', 'var(--crm-info-soft)'], violet: ['var(--crm-violet)', 'var(--crm-violet-soft)'], green: ['var(--crm-success)', 'var(--crm-success-soft)'] }[tone]; return <article className="crm-panel min-h-28 rounded-2xl p-4"><span className="grid h-8 w-8 place-items-center rounded-lg" style={{ color: colors[0], background: colors[1] }}><Icon name={icon} /></span><strong className="mt-2 block text-2xl font-black tracking-tight">{value}</strong><span className="block text-xs font-black">{label}</span><span className="mt-1 block text-[10px] text-[var(--crm-text-muted)]">{detail}</span></article> }
function ImpactBadge({ priority }: { priority: string }) { const classes = priority === 'critical' ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : priority === 'high' ? 'bg-[#ffebe4] text-[#d84315]' : priority === 'medium' ? 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'; return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black uppercase ${classes}`}>{priority}</span> }
function StatusBadge({ status }: { status: string }) { const resolved = ['resolved', 'closed'].includes(status); return <span className={`inline-flex rounded-full px-2 py-1 text-[10px] font-black capitalize ${resolved ? 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : status === 'open' ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]' : 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]'}`}>{status.replaceAll('_', ' ')}</span> }
function EmptyState({ label }: { label: string }) { return <div className="grid min-h-36 place-items-center px-4 py-8 text-center"><div><Icon name="check_circle" className="text-[28px] text-[var(--crm-success)]" /><p className="mt-2 text-xs font-bold text-[var(--crm-text-muted)]">{label}</p></div></div> }
