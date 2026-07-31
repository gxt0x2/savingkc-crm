'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { cn, formatCurrency } from '@/lib/utils'
import type { DispoDeal, DispoStage } from '@/types/dispo'

// ---------------------------------------------------------------------------
// Stage config
// ---------------------------------------------------------------------------
const STAGES: { key: DispoStage | 'all'; label: string; icon: string; color: string }[] = [
  { key: 'all', label: 'All', icon: 'view_list', color: 'bg-slate-600' },
  { key: 'new', label: 'New', icon: 'fiber_new', color: 'bg-fuchsia-600' },
  { key: 'marketing', label: 'Marketing', icon: 'campaign', color: 'bg-violet-600' },
  { key: 'offers_in', label: 'Offers In', icon: 'local_offer', color: 'bg-amber-600' },
  { key: 'negotiating', label: 'Negotiating', icon: 'handshake', color: 'bg-orange-600' },
  { key: 'under_contract', label: 'Under Contract', icon: 'description', color: 'bg-emerald-600' },
  { key: 'closed', label: 'Closed', icon: 'check_circle', color: 'bg-green-700' },
  { key: 'dead', label: 'Dead', icon: 'cancel', color: 'bg-red-700' },
]

function stageConfig(stage: DispoStage) {
  return STAGES.find((s) => s.key === stage) ?? STAGES[1]
}

function stageBadgeClass(stage: DispoStage): string {
  const map: Record<DispoStage, string> = {
    new: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]',
    marketing: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]',
    offers_in: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    negotiating: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]',
    under_contract: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
    closed: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]',
    dead: 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]',
  }
  return map[stage] ?? 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'
}

function daysAgo(iso: string) {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  return d === 0 ? 'Today' : d === 1 ? '1d ago' : `${d}d ago`
}

function formatDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ---------------------------------------------------------------------------
// Add Deal Modal
// ---------------------------------------------------------------------------
function AddDealModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [query, setQuery] = useState('')
  const [leads, setLeads] = useState<{ id: string; full_name: string; property_address: string; city: string }[]>([])
  const [searching, setSearching] = useState(false)
  const [adding, setAdding] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<NodeJS.Timeout | null>(null)

  function handleSearch(q: string) {
    setQuery(q)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!q.trim() || q.trim().length < 2) {
      setLeads([])
      setSearching(false)
      return
    }
    setSearching(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/leads/search?q=${encodeURIComponent(q)}&limit=10`)
        if (!res.ok) return
        const data = await res.json()
        setLeads(data.results ?? [])
      } finally {
        setSearching(false)
      }
    }, 400)
  }

  async function addToPipeline(leadId: string) {
    setAdding(leadId)
    setError(null)
    try {
      const res = await fetch('/api/dispo-deals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: leadId }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 409) {
          setError('This lead is already in the dispo pipeline')
        } else {
          setError(data.error || 'Failed to add deal')
        }
        return
      }
      onAdded()
    } catch {
      setError('Failed to add deal')
    } finally {
      setAdding(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="mx-4 w-full max-w-lg rounded-2xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[var(--crm-border)] px-6 py-4">
          <h2 className="text-lg font-bold text-[var(--crm-ink)]">Add Deal to Pipeline</h2>
          <button onClick={onClose} aria-label="Close add deal dialog" className="rounded-lg p-1.5 text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]">
            <Icon name="close" size="text-lg" />
          </button>
        </div>
        <div className="px-6 py-4">
          {error && (
            <div className="mb-3 rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-danger-soft)] px-3 py-2 text-sm text-[var(--crm-danger)]">
              {error}
            </div>
          )}
          <input
            type="text"
            autoFocus
            className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-4 py-2.5 text-sm text-[var(--crm-ink)] placeholder:text-[var(--crm-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--crm-focus)]/30"
            placeholder="Search leads by address, name, or city..."
            value={query}
            onChange={(e) => handleSearch(e.target.value)}
          />
          <p className="text-[10px] text-[var(--ck-text-dim)] mt-1 mb-3">
            Search for a lead to add to the dispo pipeline
          </p>

          <div className="max-h-64 overflow-y-auto space-y-1">
            {searching && (
              <div className="text-center py-4 text-[var(--ck-text-dim)] text-sm">Searching...</div>
            )}
            {!searching && leads.length === 0 && query.length >= 2 && (
              <div className="text-center py-4 text-[var(--ck-text-dim)] text-sm">No leads found</div>
            )}
            {leads.map((lead) => (
              <div
                key={lead.id}
                className="flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-[var(--crm-surface-subtle)]"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-[var(--crm-ink)]">
                    {lead.property_address || 'No address'}
                  </p>
                  <p className="text-xs text-[var(--ck-text-muted)]">
                    {lead.city} {lead.full_name ? `· ${lead.full_name}` : ''}
                  </p>
                </div>
                <button
                  onClick={() => addToPipeline(lead.id)}
                  disabled={adding === lead.id}
                  className="shrink-0 flex items-center gap-1 rounded-lg bg-[var(--crm-brand)] px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-[var(--crm-brand-hover)] disabled:opacity-50"
                >
                  {adding === lead.id ? 'Adding...' : (
                    <>
                      <Icon name="add" size="text-sm" />
                      Add
                    </>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Deal Detail Slide-over
// ---------------------------------------------------------------------------
function DealDetail({
  deal,
  onClose,
  onStageChange,
}: {
  deal: DispoDeal
  onClose: () => void
  onStageChange: (dealId: string, newStage: DispoStage) => void
}) {
  const lead = deal.lead as Record<string, unknown> | undefined
  const addr = String(lead?.property_address ?? 'No address')
  const city = String(lead?.city ?? '')
  const state = String(lead?.state ?? '')
  const arv = lead?.arv ? formatCurrency(Number(lead.arv)) : '—'
  const price = lead?.offer_amount ? formatCurrency(Number(lead.offer_amount)) : '—'
  const beds = lead?.beds ?? '—'
  const baths = lead?.baths_full ?? '—'
  const sqft = lead?.sqft ? Number(lead.sqft).toLocaleString() : '—'
  const pType = String(lead?.property_type ?? '—')

  const stagesForAdvance = STAGES.filter(
    (s) => s.key !== 'all' && s.key !== deal.stage
  ) as { key: DispoStage; label: string; icon: string; color: string }[]

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <div
        className="h-full w-full max-w-md overflow-y-auto border-l border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-[var(--crm-ink)]">{addr}</h2>
            <p className="text-xs text-[var(--ck-text-muted)]">
              {[city, state].filter(Boolean).join(', ')}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close deal details" className="rounded-lg p-2 text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)]">
            <Icon name="close" size="text-lg" />
          </button>
        </div>

        <div className="px-6 py-4 space-y-5">
          {/* Current Stage */}
          <div>
            <p className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider mb-2">
              Current Stage
            </p>
            <span className={cn('inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-bold', stageBadgeClass(deal.stage))}>
              <Icon name={stageConfig(deal.stage).icon} size="text-sm" />
              {stageConfig(deal.stage).label}
            </span>
            <p className="text-xs text-[var(--ck-text-dim)] mt-1">
              Entered {daysAgo(deal.entered_at)}
            </p>
          </div>

          {/* Property Info */}
          <div>
            <p className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider mb-2">
              Property Details
            </p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { label: 'ARV', val: arv },
                { label: 'Price', val: price },
                { label: 'Type', val: pType },
                { label: 'Bed/Bath', val: `${beds}/${baths}` },
                { label: 'Sqft', val: sqft },
                { label: 'Entered', val: formatDate(deal.entered_at) },
              ].map(({ label, val }) => (
                <div key={label} className="rounded-lg bg-[var(--crm-surface-subtle)] p-3">
                  <p className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase">{label}</p>
                  <p className="mt-0.5 text-sm font-semibold text-[var(--crm-ink)]">{val}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Summary */}
          <div>
            <p className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider mb-2">
              Activity
            </p>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Deal Page', val: deal.deal_page ? 'Live' : 'None', icon: 'description' },
                { label: 'Broadcasts', val: String(deal.broadcasts_count ?? 0), icon: 'campaign' },
                { label: 'Offers', val: String(deal.offers_count ?? 0), icon: 'local_offer' },
              ].map(({ label, val, icon }) => (
                <div key={label} className="rounded-lg bg-[var(--crm-surface-subtle)] p-3 text-center">
                  <Icon name={icon} className="text-[var(--ck-text-dim)] text-lg mb-1" />
                  <p className="text-sm font-bold text-[var(--crm-ink)]">{val}</p>
                  <p className="text-[10px] text-[var(--ck-text-dim)]">{label}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Deal Page Link */}
          {deal.deal_page && (
            <div className="rounded-lg bg-[var(--crm-surface-subtle)] p-3">
              <p className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase mb-1">Deal Page</p>
              <Link
                href={`/deals/${deal.deal_page.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-[var(--crm-brand)] underline hover:text-[var(--crm-brand-hover)]"
              >
                crm.savingkc.com/deals/{deal.deal_page.slug}
              </Link>
            </div>
          )}

          {/* Assignment Fee */}
          {deal.assignment_fee != null && (
            <div className="rounded-lg border border-[var(--crm-success)]/25 bg-[var(--crm-success-soft)] p-3">
              <p className="mb-1 text-[10px] font-bold uppercase text-[var(--crm-success)]">Assignment Fee</p>
              <p className="text-lg font-bold text-[var(--crm-success)]">
                {formatCurrency(deal.assignment_fee)}
              </p>
            </div>
          )}

          {/* Notes */}
          {deal.notes && (
            <div className="rounded-lg bg-[var(--crm-surface-subtle)] p-3">
              <p className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase mb-1">Notes</p>
              <p className="text-sm text-[var(--ck-text-muted)]">{deal.notes}</p>
            </div>
          )}

          {/* Move Stage */}
          <div>
            <p className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider mb-2">
              Move to Stage
            </p>
            <div className="flex flex-wrap gap-1.5">
              {stagesForAdvance.map((s) => (
                <button
                  key={s.key}
                  onClick={() => onStageChange(deal.id, s.key)}
                  className={cn(
                    'flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors',
                    'border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand-border)] hover:bg-[var(--crm-brand-soft)] hover:text-[var(--crm-brand)]'
                  )}
                >
                  <Icon name={s.icon} size="text-sm" />
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Pipeline Page
// ---------------------------------------------------------------------------
export default function PipelinePage() {
  const [deals, setDeals] = useState<DispoDeal[]>([])
  const [loading, setLoading] = useState(true)
  const [stageFilter, setStageFilter] = useState<DispoStage | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selectedDeal, setSelectedDeal] = useState<DispoDeal | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchValueRef = useRef(search)

  const fetchDeals = useCallback(async (searchOverride = searchValueRef.current) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (stageFilter !== 'all') params.set('stage', stageFilter)
      if (searchOverride.trim()) params.set('search', searchOverride.trim())
      const res = await fetch(`/api/dispo-deals?${params}`)
      if (!res.ok) throw new Error('Failed to fetch deals')
      const data = await res.json()
      setDeals(data.deals ?? [])
    } catch {
      setError('Failed to load pipeline')
    } finally {
      setLoading(false)
    }
  }, [stageFilter])

  useEffect(() => {
    fetchDeals()
  }, [fetchDeals])

  // Debounced search
  const searchRef = useRef<NodeJS.Timeout | null>(null)
  function handleSearch(q: string) {
    searchValueRef.current = q
    setSearch(q)
    if (searchRef.current) clearTimeout(searchRef.current)
    searchRef.current = setTimeout(() => fetchDeals(q), 400)
  }

  async function handleStageChange(dealId: string, newStage: DispoStage) {
    try {
      const res = await fetch(`/api/dispo-deals/${dealId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stage: newStage }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Failed to update stage')
      }
      setFeedback(`Moved to ${stageConfig(newStage).label}`)
      setTimeout(() => setFeedback(null), 2500)
      setSelectedDeal(null)
      fetchDeals()
    } catch (err: unknown) {
      setFeedback(err instanceof Error ? err.message : 'Error updating stage')
      setTimeout(() => setFeedback(null), 3000)
    }
  }

  // Compute stage counts from ALL deals (not filtered)
  const [allDeals, setAllDeals] = useState<DispoDeal[]>([])
  useEffect(() => {
    async function fetchAll() {
      try {
        const res = await fetch('/api/dispo-deals?limit=500')
        if (!res.ok) return
        const data = await res.json()
        setAllDeals(data.deals ?? [])
      } catch { /* ignore */ }
    }
    fetchAll()
  }, [deals])

  const stageCounts = allDeals.reduce<Record<string, number>>((acc, d) => {
    acc[d.stage] = (acc[d.stage] || 0) + 1
    return acc
  }, {})

  const activeDealCount = allDeals.filter((d) => d.stage !== 'closed' && d.stage !== 'dead').length

  return (
    <div className="mx-auto min-h-full w-full max-w-[1440px] bg-[var(--crm-canvas)] px-4 pb-24 pt-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-[var(--crm-brand)]">Disposition workspace</p>
          <h1 className="mb-1 text-3xl font-bold tracking-tight text-[var(--crm-ink)]">Pipeline</h1>
          <p className="text-[var(--ck-text-muted)] text-sm">
            {loading ? 'Loading...' : `${activeDealCount} active deal${activeDealCount !== 1 ? 's' : ''} in dispo`}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 rounded-lg bg-[var(--crm-brand)] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition-colors hover:bg-[var(--crm-brand-hover)]"
        >
          <Icon name="add_circle" size="text-lg" />
          Add Deal
        </button>
      </div>

      {/* Stage Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 mb-6">
        {STAGES.filter((s) => s.key !== 'all').map((s) => {
          const count = stageCounts[s.key] || 0
          return (
            <button
              key={s.key}
              onClick={() => setStageFilter(stageFilter === s.key ? 'all' : (s.key as DispoStage))}
              className={cn(
                'rounded-xl border p-3 text-left shadow-sm transition-all',
                stageFilter === s.key
                  ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)]'
                  : 'border-[var(--crm-border)] bg-[var(--crm-surface)] hover:border-[var(--crm-border-strong)] hover:bg-[var(--crm-surface-subtle)]'
              )}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <Icon name={s.icon} className="text-[var(--ck-text-dim)]" size="text-sm" />
                <span className="text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider">
                  {s.label}
                </span>
              </div>
              <p className="text-xl font-bold text-[var(--crm-ink)]">{count}</p>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative max-w-sm">
          <Icon
            name="search"
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--ck-text-dim)]"
            size="text-lg"
          />
          <input
            type="text"
            className="w-full rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] py-2 pl-10 pr-4 text-sm text-[var(--crm-ink)] shadow-sm placeholder:text-[var(--crm-text-dim)] focus:outline-none focus:ring-2 focus:ring-[var(--crm-focus)]/25"
            placeholder="Search by address, name, or city..."
            value={search}
            onChange={(e) => handleSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Stage Filter Pills */}
      <div className="mb-4 flex flex-wrap gap-1">
        {STAGES.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setStageFilter(key as DispoStage | 'all')}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold transition-colors',
              stageFilter === key
                ? 'bg-[var(--crm-brand)] text-white'
                : 'border border-[var(--crm-border)] bg-[var(--crm-surface)] text-[var(--crm-text-muted)] hover:border-[var(--crm-brand-border)] hover:bg-[var(--crm-brand-soft)] hover:text-[var(--crm-brand)]'
            )}
          >
            {label}
            {key !== 'all' && stageCounts[key] ? ` (${stageCounts[key]})` : ''}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-[var(--crm-brand-border)] bg-[var(--crm-danger-soft)] px-4 py-3 text-sm text-[var(--crm-danger)]">
          {error}
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="text-[var(--ck-text-dim)] py-16 text-center">Loading pipeline...</div>
      ) : deals.length === 0 ? (
        <div className="text-center py-20">
          <Icon name="route" className="text-5xl text-[var(--ck-text-dim)] mb-4" />
          <p className="text-[var(--ck-text-muted)] font-medium text-lg">No deals in pipeline</p>
          <p className="text-[var(--ck-text-dim)] text-sm mt-1">
            {stageFilter !== 'all'
              ? `No deals at "${stageConfig(stageFilter as DispoStage).label}" stage.`
              : 'Click "Add Deal" to move a lead into the dispo pipeline.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]">
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider">
                    Property
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider">
                    Stage
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider hidden sm:table-cell">
                    ARV
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider hidden sm:table-cell">
                    Price
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider hidden md:table-cell">
                    Deal Page
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider hidden md:table-cell">
                    Broadcasts
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider hidden lg:table-cell">
                    Offers
                  </th>
                  <th className="text-left px-4 py-3 text-[10px] font-bold text-[var(--ck-text-dim)] uppercase tracking-wider hidden lg:table-cell">
                    Entered
                  </th>
                  <th className="w-10 px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => {
                  const raw = deal as unknown as Record<string, unknown>
                  const lead = (raw.leads ?? raw.lead ?? deal.lead) as Record<string, unknown> | undefined
                  const addr = String(lead?.property_address ?? 'No address')
                  const city = String(lead?.city ?? '')
                  const state = String(lead?.state ?? '')
                  const arv = lead?.arv ? formatCurrency(Number(lead.arv)) : '—'
                  const price = lead?.offer_amount ? formatCurrency(Number(lead.offer_amount)) : '—'

                  return (
                    <tr
                      key={deal.id}
                      className="cursor-pointer border-b border-[var(--crm-border)] transition-colors hover:bg-[var(--crm-surface-subtle)]"
                      onClick={() =>
                        setSelectedDeal({
                          ...deal,
                          lead: lead as DispoDeal['lead'],
                        })
                      }
                    >
                      <td className="px-4 py-3">
                        <p className="max-w-[200px] truncate font-medium text-[var(--crm-ink)]">{addr}</p>
                        <p className="text-xs text-[var(--ck-text-dim)]">
                          {[city, state].filter(Boolean).join(', ')}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold',
                            stageBadgeClass(deal.stage)
                          )}
                        >
                          <Icon name={stageConfig(deal.stage).icon} size="text-xs" />
                          {stageConfig(deal.stage).label}
                        </span>
                        {deal.tc_file && (
                          <span className={cn(
                            'mt-1 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold',
                            deal.tc_file.risk_level === 'blocked'
                              ? 'bg-[var(--crm-danger-soft)] text-[var(--crm-danger)]'
                              : 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]'
                          )}>
                            <Icon name="fact_check" size="text-xs" />
                            TC {deal.tc_file.status.replace(/_/g, ' ')}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--ck-text-muted)] hidden sm:table-cell">
                        {arv}
                      </td>
                      <td className="hidden px-4 py-3 font-semibold text-[var(--crm-ink)] sm:table-cell">
                        {price}
                      </td>
                      <td className="px-4 py-3 hidden md:table-cell">
                        {deal.deal_page ? (
                          <span className="inline-flex items-center gap-1 text-xs text-[var(--crm-success)]">
                            <Icon name="check_circle" size="text-xs" />
                            Live
                          </span>
                        ) : (
                          <span className="text-[var(--ck-text-dim)] text-xs">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--ck-text-muted)] hidden md:table-cell">
                        {deal.broadcasts_count || '—'}
                      </td>
                      <td className="px-4 py-3 hidden lg:table-cell">
                        {(deal.offers_count ?? 0) > 0 ? (
                          <span className="font-semibold text-[var(--crm-warning)]">{deal.offers_count}</span>
                        ) : (
                          <span className="text-[var(--ck-text-dim)]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--ck-text-dim)] text-xs whitespace-nowrap hidden lg:table-cell">
                        {daysAgo(deal.entered_at)}
                      </td>
                      <td className="px-4 py-3">
                        <Icon name="chevron_right" className="text-[var(--ck-text-dim)]" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Add Deal Modal */}
      {showAddModal && (
        <AddDealModal
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            setShowAddModal(false)
            setFeedback('Deal added to pipeline')
            setTimeout(() => setFeedback(null), 2500)
            fetchDeals()
          }}
        />
      )}

      {/* Deal Detail Slide-over */}
      {selectedDeal && (
        <DealDetail
          deal={selectedDeal}
          onClose={() => setSelectedDeal(null)}
          onStageChange={handleStageChange}
        />
      )}

      {/* Feedback toast */}
      {feedback && (
        <div className="fixed bottom-8 left-1/2 z-50 -translate-x-1/2 rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-2.5 text-sm font-medium text-[var(--crm-ink)] shadow-xl">
          {feedback}
        </div>
      )}
    </div>
  )
}
