'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { HotOpportunityRow } from '@/components/opportunities/hot-opportunity-row'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import { SmsComposeModal } from '@/components/leads/sms-compose-modal'
import { Icon } from '@/components/ui/icon'
import { useHotOpportunities, useRefreshHotList } from '@/hooks/use-hot-opportunities'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  DragOverlay,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import type { HotOpportunityData } from '@/types/hot-opportunity'

type SortOption = 'score' | 'recent' | 'arv' | 'custom'
type FilterOption = 'all' | 'hot' | 'appts' | 'missing-data'

const ORDER_KEY = 'hot-opportunities-custom-order'

export default function OpportunitiesPage() {
  const [showAdd, setShowAdd] = useState(false)
  const { data: hotData, isLoading } = useHotOpportunities()
  const refreshHotList = useRefreshHotList()

  const [sortBy, setSortBy] = useState<SortOption>('score')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [customOrder, setCustomOrder] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {}
    try {
      const saved = localStorage.getItem(ORDER_KEY)
      return saved ? JSON.parse(saved) : {}
    } catch { return {} }
  })
  const [rerankBusy, setRerankBusy] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)

  // Modal states
  const [smsModalOpen, setSmsModalOpen] = useState(false)
  const [selectedLeadForModal, setSelectedLeadForModal] = useState<any>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  // Single source of truth for sorted + filtered list. Derived from hotData +
  // sortBy + filterBy + customOrder via useMemo — no useEffect/setState round-trip
  // (that was the bug: effect was wiping handleSort's setState on every sortBy change).
  const visibleOpps: HotOpportunityData[] = useMemo(() => {
    const items = hotData?.items ? [...hotData.items] : []
    // Sort
    switch (sortBy) {
      case 'score':
        items.sort((a, b) => b.score.composite - a.score.composite)
        break
      case 'recent':
        items.sort((a, b) => {
          const aT = a.lastScoredAt ? new Date(a.lastScoredAt).getTime() : 0
          const bT = b.lastScoredAt ? new Date(b.lastScoredAt).getTime() : 0
          return bT - aT
        })
        break
      case 'arv':
        items.sort((a, b) => (b.dealMath.arv ?? 0) - (a.dealMath.arv ?? 0))
        break
      case 'custom':
        items.sort((a, b) => {
          const aO = customOrder[a.leadId] ?? 999
          const bO = customOrder[b.leadId] ?? 999
          return aO - bO
        })
        break
    }
    // Filter
    return items.filter((opp) => {
      switch (filterBy) {
        case 'hot':
          return opp.score.composite >= 75
        case 'appts':
          return opp.flags.hasDeadline || opp.currentStation === 'appt_set'
        case 'missing-data':
          return opp.missingFields.length > 0
        default:
          return true
      }
    })
  }, [hotData, sortBy, filterBy, customOrder])

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    setActiveId(null)
    if (!over || active.id === over.id) return

    const oldIndex = visibleOpps.findIndex((i) => i.leadId === active.id)
    const newIndex = visibleOpps.findIndex((i) => i.leadId === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const newOrder = arrayMove(visibleOpps, oldIndex, newIndex)
    const orderMap: Record<string, number> = {}
    newOrder.forEach((it, i) => { orderMap[it.leadId] = i })
    setCustomOrder(orderMap)
    setSortBy('custom')
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(orderMap)) } catch {}
  }

  async function handleRerank() {
    setRerankBusy(true)
    try {
      await refreshHotList(true)
    } finally {
      setRerankBusy(false)
    }
  }

  // Action handlers
  function handleCall(phone: string, leadId: string, name?: string) {
    window.dispatchEvent(new CustomEvent('open-dialer', {
      detail: { phone, leadId, name },
    }))
  }

  async function handleSms(leadId: string, phone?: string) {
    const supabase = createClient()
    const { data: lead } = await supabase
      .from('leads').select('*').eq('id', leadId).single()
    if (lead) {
      setSelectedLeadForModal(lead)
      setSmsModalOpen(true)
    }
  }

  function handleEmail(email?: string) {
    if (email) window.location.href = `mailto:${email}`
  }

  return (
    <div className="min-h-screen">
      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); refreshHotList(true) }}
        />
      )}

      {smsModalOpen && selectedLeadForModal && (
        <SmsComposeModal
          lead={selectedLeadForModal}
          onClose={() => {
            setSmsModalOpen(false)
            setSelectedLeadForModal(null)
          }}
          onSent={() => {}}
        />
      )}

      <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="text-[10px] font-black text-[#E32E2E] uppercase tracking-[0.25em]">
              Priority Queue
            </span>
            <h1 className="text-3xl font-black text-[var(--ck-text)] tracking-tight mt-1">Hot Opps</h1>
            <p className="text-xs text-[var(--ck-text-muted)] mt-1">
              {visibleOpps.length} ranked leads · drag to reorder · click a row to open
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRerank}
              disabled={rerankBusy}
              className="px-4 py-2 ck-card-elev border border-[var(--ck-border)] hover:border-[var(--ck-border-strong)] text-[var(--ck-text)] font-bold rounded-lg text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
            >
              <Icon
                name="refresh"
                size="text-sm"
                className={rerankBusy ? 'animate-spin' : ''}
              />
              {rerankBusy ? 'Ranking…' : 'Re-rank'}
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 bg-[#E32E2E] hover:bg-[#C42626] text-white font-bold rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <Icon name="add" size="text-sm" />
              Add Lead
            </button>
          </div>
        </div>

        {/* Filter + Sort bar */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 ck-card-elev rounded-lg">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-muted)] mr-1">Filter</span>
            {([
              { k: 'all', label: 'All' },
              { k: 'hot', label: 'Hot (75+)' },
              { k: 'appts', label: 'Appointments' },
              { k: 'missing-data', label: 'Missing Data' },
            ] as { k: FilterOption; label: string }[]).map(({ k, label }) => (
              <button
                key={k}
                onClick={() => setFilterBy(k)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${
                  filterBy === k
                    ? 'bg-[#E32E2E] text-white'
                    : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-wider text-[var(--ck-text-muted)] mr-1">Sort</span>
            {([
              { k: 'score', label: 'Score' },
              { k: 'recent', label: 'Recent' },
              { k: 'arv', label: 'ARV' },
              { k: 'custom', label: 'Custom' },
            ] as { k: SortOption; label: string }[]).map(({ k, label }) => (
              <button
                key={k}
                onClick={() => setSortBy(k)}
                className={`px-2.5 py-1 text-[11px] font-bold rounded-md transition-colors ${
                  sortBy === k
                    ? 'bg-[var(--ck-surface-hi)] text-[var(--ck-text)] border border-[var(--ck-border-strong)]'
                    : 'text-[var(--ck-text-muted)] hover:text-[var(--ck-text)] hover:bg-white/5'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* List */}
        {isLoading ? (
          <div className="py-16 text-center text-sm text-[var(--ck-text-muted)]">Ranking opportunities…</div>
        ) : visibleOpps.length === 0 ? (
          <div className="py-16 text-center ck-card">
            <Icon name="inbox" size="text-3xl" className="text-[var(--ck-text-dim)] block mx-auto mb-2" />
            <p className="text-sm text-[var(--ck-text-muted)] mb-4">No opportunities match your filter</p>
            <button
              onClick={() => setFilterBy('all')}
              className="px-4 py-2 bg-[var(--ck-surface-elev)] border border-[var(--ck-border)] text-[var(--ck-text)] text-sm font-bold rounded-lg"
            >
              Show All
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={(e) => setActiveId(e.active.id as string)}
            onDragEnd={handleDragEnd}
            onDragCancel={() => setActiveId(null)}
          >
            <SortableContext
              items={visibleOpps.map((o) => o.leadId)}
              strategy={verticalListSortingStrategy}
            >
              <div className="space-y-1.5">
                {visibleOpps.map((opp, idx) => (
                  <HotOpportunityRow
                    key={opp.leadId}
                    opp={opp}
                    rank={idx + 1}
                    onCall={(phone, leadId) => handleCall(phone, leadId, opp.sellerName)}
                    onSms={(leadId, phone) => handleSms(leadId, phone)}
                    onEmail={handleEmail}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId ? (
                <div className="opacity-80 scale-[1.02] shadow-2xl">
                  <HotOpportunityRow
                    opp={visibleOpps.find((o) => o.leadId === activeId)!}
                    rank={visibleOpps.findIndex((o) => o.leadId === activeId) + 1}
                    onCall={handleCall}
                    onSms={handleSms}
                    onEmail={handleEmail}
                  />
                </div>
              ) : null}
            </DragOverlay>
          </DndContext>
        )}
      </div>
    </div>
  )
}
