'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { HotOpportunityCardCompact } from '@/components/opportunities/hot-opportunity-card-compact'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import { SmsComposeModal } from '@/components/leads/sms-compose-modal'
import { Icon } from '@/components/ui/icon'
import { toProperCase } from '@/lib/format'
import { useHotOpportunities, useRefreshHotList } from '@/hooks/use-hot-opportunities'
import type { Deal, Contact, DealStage } from '@/types'
import type { ManifestV2 } from '@/lib/manifest-builder'
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
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import type { HotOpportunityData } from '@/types/hot-opportunity'

interface LeadRow {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  state: string | null
  zip: string | null
  source: string | null
  station: string | null
  priority: string | null
  notes: string | null
  created_at: string
  updated_at: string
  is_favorite: boolean | null
  arv: number | null
  offer_amount: number | null
  repair_estimate: number | null
  motivation_score: number | null
  seller_situation: string | null
  appointment_date: string | null
}

type SortOption = 'score' | 'recent' | 'arv' | 'custom'
type FilterOption = 'all' | 'favorites' | 'appts' | 'missing-data'

export default function OpportunitiesPageV2() {
  const router = useRouter()
  const [showAdd, setShowAdd] = useState(false)
  const { data: hotData, isLoading: hotLoading } = useHotOpportunities()
  const refreshHotList = useRefreshHotList()

  const [opportunities, setOpportunities] = useState<HotOpportunityData[]>([])
  const [sortBy, setSortBy] = useState<SortOption>('score')
  const [filterBy, setFilterBy] = useState<FilterOption>('all')
  const [activeId, setActiveId] = useState<string | null>(null)

  // Modal states
  const [smsModalOpen, setSmsModalOpen] = useState(false)
  const [selectedLeadForModal, setSelectedLeadForModal] = useState<any>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8, // 8px movement required before drag starts
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  )

  useEffect(() => {
    if (hotData?.items) {
      // Load custom order from localStorage if it exists
      const savedOrder = localStorage.getItem('hot-opportunities-custom-order')
      if (savedOrder && sortBy === 'custom') {
        try {
          const orderMap = JSON.parse(savedOrder) as Record<string, number>
          const sorted = [...hotData.items].sort((a, b) => {
            const aOrder = orderMap[a.leadId] ?? 999
            const bOrder = orderMap[b.leadId] ?? 999
            return aOrder - bOrder
          })
          setOpportunities(sorted)
          return
        } catch (e) {
          // Invalid saved order, ignore
        }
      }
      setOpportunities([...hotData.items])
    }
  }, [hotData, sortBy])

  function handleDragStart(event: any) {
    setActiveId(event.active.id)
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event

    setActiveId(null)

    if (over && active.id !== over.id) {
      setOpportunities((items) => {
        const oldIndex = items.findIndex(item => item.leadId === active.id)
        const newIndex = items.findIndex(item => item.leadId === over.id)

        if (oldIndex === -1 || newIndex === -1) return items

        const newOrder = arrayMove(items, oldIndex, newIndex)

        // Mark as custom sort
        setSortBy('custom')

        // Save order to localStorage
        const orderMap: Record<string, number> = {}
        newOrder.forEach((item, index) => {
          orderMap[item.leadId] = index
        })
        localStorage.setItem('hot-opportunities-custom-order', JSON.stringify(orderMap))

        return newOrder
      })
    }
  }

  function handleDragCancel() {
    setActiveId(null)
  }

  function handleSort(option: SortOption) {
    setSortBy(option)

    if (!hotData?.items) return

    let sorted = [...hotData.items]

    switch (option) {
      case 'score':
        sorted.sort((a, b) => b.score.composite - a.score.composite)
        break
      case 'recent':
        sorted.sort((a, b) => {
          const dateA = a.lastScoredAt ? new Date(a.lastScoredAt).getTime() : 0
          const dateB = b.lastScoredAt ? new Date(b.lastScoredAt).getTime() : 0
          return dateB - dateA
        })
        break
      case 'arv':
        sorted.sort((a, b) => (b.dealMath.arv ?? 0) - (a.dealMath.arv ?? 0))
        break
      case 'custom':
        // Keep current order
        return
    }

    setOpportunities(sorted)
  }

  const filteredOpps = opportunities.filter(opp => {
    switch (filterBy) {
      case 'favorites':
        // Check if lead has priority signals
        return opp.score.composite >= 75
      case 'appts':
        return opp.flags.hasDeadline || opp.currentStation === 'appt_set'
      case 'missing-data':
        return opp.missingFields.length > 0
      default:
        return true
    }
  })

  // Action handlers
  function handleCall(phone: string, leadId: string, name?: string) {
    console.log('[OPPORTUNITIES PAGE] handleCall triggered:', { phone, leadId, name })
    const event = new CustomEvent('open-dialer', {
      detail: { phone, leadId, name }
    })
    window.dispatchEvent(event)
    console.log('[OPPORTUNITIES PAGE] open-dialer event dispatched with detail:', { phone, leadId, name })
  }

  async function handleSms(leadId: string, phone?: string, name?: string) {
    console.log('[OPPORTUNITIES PAGE] handleSms triggered:', { leadId, phone, name })
    // Fetch the full lead object
    const supabase = createClient()
    const { data: lead } = await supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single()

    if (lead) {
      setSelectedLeadForModal(lead)
      setSmsModalOpen(true)
    }
  }

  function handleEmail(email?: string) {
    console.log('[OPPORTUNITIES PAGE] handleEmail triggered with email:', email)
    if (email) {
      console.log('[OPPORTUNITIES PAGE] Opening mailto:', email)
      window.location.href = `mailto:${email}`
    } else {
      console.log('[OPPORTUNITIES PAGE] No email provided, skipping mailto')
    }
  }

  return (
    <div className="min-h-screen bg-white">
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
          onSent={() => {
            // Optionally refresh the list
          }}
        />
      )}

      <div className="max-w-[1800px] mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <h1 className="text-4xl font-black text-black tracking-tight">Hot Opps</h1>
            <p className="text-gray-600 mt-2">
              {filteredOpps.length} active deals · Drag to reorder · Click to view
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={() => refreshHotList(true)}
              className="px-4 py-2 border-2 border-black text-black font-bold rounded-lg hover:bg-black hover:text-white transition-colors"
            >
              <Icon name="refresh" size="text-sm" className="inline mr-2" />
              Re-rank
            </button>
            <button
              onClick={() => setShowAdd(true)}
              className="px-4 py-2 bg-[#E32E2E] text-white font-bold rounded-lg hover:bg-[#C42626] transition-colors"
            >
              <Icon name="add" size="text-sm" className="inline mr-2" />
              Add Lead
            </button>
          </div>
        </div>

        {/* Filters & Sort */}
        <div className="mb-6 flex items-center justify-between bg-gray-50 rounded-lg p-4 border-2 border-gray-200">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700 mr-2">Filter:</span>
            {(['all', 'favorites', 'appts', 'missing-data'] as FilterOption[]).map(option => (
              <button
                key={option}
                onClick={() => setFilterBy(option)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  filterBy === option
                    ? 'bg-black text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:border-black'
                }`}
              >
                {option === 'all' && 'All'}
                {option === 'favorites' && '⭐ Favorites'}
                {option === 'appts' && '📅 Appointments'}
                {option === 'missing-data' && '⚠️ Missing Data'}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-gray-700 mr-2">Sort:</span>
            {(['score', 'recent', 'arv', 'custom'] as SortOption[]).map(option => (
              <button
                key={option}
                onClick={() => handleSort(option)}
                className={`px-3 py-1.5 rounded-md text-xs font-bold transition-colors ${
                  sortBy === option
                    ? 'bg-[#E32E2E] text-white'
                    : 'bg-white text-gray-700 border border-gray-300 hover:border-[#E32E2E]'
                }`}
              >
                {option === 'score' && 'Score'}
                {option === 'recent' && 'Recent'}
                {option === 'arv' && 'ARV'}
                {option === 'custom' && 'Custom Order'}
              </button>
            ))}
          </div>
        </div>

        {/* Cards Grid */}
        {hotLoading ? (
          <div className="text-center py-16">
            <div className="text-gray-400 text-lg">Ranking opportunities...</div>
          </div>
        ) : filteredOpps.length === 0 ? (
          <div className="text-center py-16 bg-gray-50 rounded-lg border-2 border-gray-200">
            <p className="text-gray-600 mb-4">No opportunities match your filter</p>
            <button
              onClick={() => setFilterBy('all')}
              className="px-4 py-2 bg-black text-white font-bold rounded-lg"
            >
              Show All
            </button>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={filteredOpps.map(opp => opp.leadId)}
              strategy={rectSortingStrategy}
            >
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {filteredOpps.map((opp, index) => (
                  <HotOpportunityCardCompact
                    key={opp.leadId}
                    opp={opp}
                    variant={index % 4 === 0 ? 'white' : index % 4 === 1 ? 'grey' : index % 4 === 2 ? 'lightgrey' : 'red'}
                    onCall={(phone, leadId) => handleCall(phone, leadId, opp.sellerName)}
                    onSms={(leadId, phone) => handleSms(leadId, phone, opp.sellerName)}
                    onEmail={handleEmail}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay>
              {activeId ? (
                <div className="opacity-50 scale-105 shadow-2xl">
                  <HotOpportunityCardCompact
                    opp={filteredOpps.find(o => o.leadId === activeId)!}
                    variant="white"
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
