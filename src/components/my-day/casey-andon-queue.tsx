'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'

import { Icon } from '@/components/ui/icon'
import { ANDON_KIND_LABELS, type AndonIssueKind } from '@/lib/andon'

type QueueView = 'active' | 'completed' | 'all'

interface AndonItem {
  id: string
  issue_kind: AndonIssueKind
  department: string
  category: string
  description: string
  priority: string
  status: string
  created_at: string
  record_id?: string | null
  record_url?: string | null
  assignee?: string | null
  estimated_resolution_at?: string | null
  agent_name?: string | null
  source: 'feedback' | 'error_log'
}

interface AndonResponse { items: AndonItem[] }

export function affectsCasey(item: Pick<AndonItem, 'department' | 'assignee'>) {
  const department = item.department.trim().toLowerCase()
  const assignee = item.assignee?.trim().toLowerCase() ?? ''
  return department === 'acquisitions' || department === 'acquisition' || assignee === 'casey'
}

function Count({ value }: { value: number }) {
  return <span className="ml-1 rounded-full bg-[var(--crm-surface-subtle)] px-2 py-0.5 text-[10px]">{value}</span>
}

function QueueButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className={`rounded-lg px-3 py-2 text-xs font-black ${active ? 'bg-[var(--crm-brand-soft)] text-[var(--crm-brand)] ring-1 ring-[var(--crm-brand-border)]' : 'text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]'}`}>{children}</button>
}

export function CaseyAndonQueue() {
  const [view, setView] = useState<QueueView>('active')
  const [kind, setKind] = useState<'all' | AndonIssueKind>('all')
  const [search, setSearch] = useState('')
  const { data, isLoading, error } = useQuery<AndonResponse>({
    queryKey: ['casey-my-day-andons'],
    queryFn: async () => {
      const response = await fetch('/api/feedback/log', { cache: 'no-store' })
      if (!response.ok) throw new Error('Casey’s Andon queue could not load.')
      return response.json() as Promise<AndonResponse>
    },
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  })
  const scoped = useMemo(() => (data?.items ?? []).filter(affectsCasey), [data])
  const active = scoped.filter((item) => !['resolved', 'closed'].includes(item.status))
  const completed = scoped.filter((item) => ['resolved', 'closed'].includes(item.status))
  const shown = scoped.filter((item) => {
    if (view === 'active' && ['resolved', 'closed'].includes(item.status)) return false
    if (view === 'completed' && !['resolved', 'closed'].includes(item.status)) return false
    if (kind !== 'all' && item.issue_kind !== kind) return false
    const query = search.trim().toLowerCase()
    return !query || [item.description, item.department, item.category, item.assignee, item.record_id].join(' ').toLowerCase().includes(query)
  })

  return (
    <section className="crm-panel overflow-hidden rounded-2xl">
      <header className="border-b border-[var(--crm-border)] px-4 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div><p className="crm-eyebrow">Operating queue</p><h2 className="mt-1 text-[22px] font-black tracking-[-0.02em]">Andons requiring review</h2></div>
          <div className="flex flex-wrap gap-2">
            <label className="relative"><Icon name="search" className="pointer-events-none absolute left-3 top-2.5 text-[18px] text-[var(--crm-text-muted)]" /><input aria-label="Search Casey Andons" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search Andons..." className="crm-field h-10 w-56 rounded-xl pl-9 pr-3 text-xs font-semibold" /></label>
            <select aria-label="Andon type filter" value={kind} onChange={(event) => setKind(event.target.value as 'all' | AndonIssueKind)} className="crm-field h-10 rounded-xl px-3 text-xs font-bold"><option value="all">All issue types</option>{Object.entries(ANDON_KIND_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Casey Andon queue view"><QueueButton active={view === 'active'} onClick={() => setView('active')}>Active queue <Count value={active.length} /></QueueButton><QueueButton active={view === 'completed'} onClick={() => setView('completed')}>Resolved / closed <Count value={completed.length} /></QueueButton><QueueButton active={view === 'all'} onClick={() => setView('all')}>All <Count value={scoped.length} /></QueueButton></div>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1200px] text-xs">
          <thead className="bg-[var(--crm-surface-subtle)] text-[10px] font-black uppercase tracking-wider text-[var(--crm-text-muted)]"><tr><th className="px-4 py-3 text-left">Issue</th><th className="px-4 py-3 text-left">Property / lead</th><th className="px-4 py-3 text-left">Work area</th><th className="px-4 py-3 text-left">Specific process</th><th className="px-4 py-3 text-left">Impact</th><th className="px-4 py-3 text-left">Assignee</th><th className="px-4 py-3 text-left">Target</th><th className="px-4 py-3 text-left">Status</th><th className="px-4 py-3 text-left">Raised</th><th className="px-4 py-3 text-left">By</th></tr></thead>
          <tbody>
            {isLoading ? <tr><td colSpan={10} className="px-4 py-12 text-center font-semibold text-[var(--crm-text-muted)]">Loading Casey’s Andons…</td></tr> : error ? <tr><td colSpan={10} className="px-4 py-12 text-center font-bold text-[var(--crm-danger)]">{error.message}</td></tr> : shown.length === 0 ? <tr><td colSpan={10}><div className="grid min-h-36 place-items-center px-4 py-8 text-center"><div><Icon name="check_circle" className="text-[28px] text-[var(--crm-success)]" /><p className="mt-2 text-xs font-bold text-[var(--crm-text-muted)]">No active Andons affecting Casey or Acquisitions</p></div></div></td></tr> : shown.map((item) => <tr key={`${item.source}-${item.id}`} className="border-t border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)]"><td className="max-w-[300px] px-4 py-3"><strong>{ANDON_KIND_LABELS[item.issue_kind]}</strong><span className="mt-0.5 block truncate text-[var(--crm-text-muted)]">{item.description}</span></td><td className="px-4 py-3">{item.record_url ? <a href={item.record_url} className="font-black text-[var(--crm-info)] hover:underline">{item.record_id || 'Open record'}</a> : <span className="text-[var(--crm-text-muted)]">Not linked</span>}</td><td className="px-4 py-3 font-bold">{item.department}</td><td className="px-4 py-3 text-[var(--crm-text-muted)]">{item.category}</td><td className="px-4 py-3 font-black capitalize">{item.priority}</td><td className="px-4 py-3 font-bold">{item.assignee || 'Unassigned'}</td><td className="px-4 py-3 text-[var(--crm-text-muted)]">{item.estimated_resolution_at ? new Date(item.estimated_resolution_at).toLocaleDateString() : '—'}</td><td className="px-4 py-3 font-bold capitalize">{item.status.replaceAll('_', ' ')}</td><td className="px-4 py-3 text-[var(--crm-text-muted)]">{new Date(item.created_at).toLocaleDateString()}</td><td className="px-4 py-3">{item.agent_name || 'System'}</td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  )
}
