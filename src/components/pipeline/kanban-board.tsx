'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanColumn } from './kanban-column'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import type { KanbanCardData } from './kanban-card'
import type { DealStage } from '@/types'

const columns: { title: string; stage: DealStage; number: number }[] = [
  { title: 'New', stage: 'new', number: 1 },
  { title: 'Contacted', stage: 'contacted', number: 2 },
  { title: 'Qualified', stage: 'qualified', number: 3 },
  { title: 'Offer Made', stage: 'offer_made', number: 4 },
  { title: 'Under Contract', stage: 'under_contract', number: 5 },
  { title: 'Disposition', stage: 'disposition', number: 6 },
  { title: 'Closed', stage: 'closed', number: 7 },
]

function stationToStage(station: string | null): DealStage | null {
  // Direct mapping - station is now the canonical stage ID
  const validStages: DealStage[] = [
    'new',
    'contacted',
    'qualified',
    'offer_made',
    'under_contract',
    'disposition',
    'closed',
  ]

  // Legacy mapping for backward compatibility
  const legacyMap: Record<string, DealStage> = {
    intake: 'new',
    not_contacted: 'new',
    qualifying: 'qualified',
    appt_set: 'qualified',
    negotiations: 'offer_made',
    contract_signed: 'under_contract',
  }

  if (!station) return null
  if (validStages.includes(station as DealStage)) return station as DealStage
  return legacyMap[station] ?? null
}

function getInitials(name: string | null): string {
  if (!name) return '??'
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const AVATAR_COLORS = [
  'bg-primary-fixed text-on-primary-fixed',
  'bg-secondary-fixed text-on-secondary-fixed',
  'bg-tertiary-fixed text-on-tertiary-fixed',
  'bg-surface-variant text-on-surface',
  'bg-secondary-fixed-dim text-on-secondary-fixed',
]

function avatarColor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) & 0xffff
  return AVATAR_COLORS[hash % AVATAR_COLORS.length]
}

interface Lead {
  id: string
  full_name: string | null
  phone: string | null
  email: string | null
  property_address: string | null
  city: string | null
  station: string | null
  priority: string | null
  created_at: string
}

export function KanbanBoard({ onNewLead, showFilters, filterPriority }: {
  onNewLead?: () => void
  showFilters?: boolean
  filterPriority?: string
}) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, station, priority, created_at')
      .not('station', 'eq', 'dead')
      .order('created_at', { ascending: false })
      .limit(500)
    setLeads((data as Lead[]) || [])
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  // Handle new lead trigger from parent
  useEffect(() => {
    if (onNewLead !== undefined) {
      // Parent controls Add Lead, we just expose fetchLeads via effect
    }
  }, [onNewLead])

  const filteredLeads = leads.filter((lead) => {
    if (filterPriority && filterPriority !== 'all' && lead.priority !== filterPriority) return false
    return true
  })

  const cardsByStage: Record<DealStage, KanbanCardData[]> = {
    new: [],
    not_contacted: [],
    contacted: [],
    qualifying: [],
    qualified: [],
    appt_set: [],
    negotiations: [],
    contract_signed: [],
    offer_made: [],
    under_contract: [],
    disposition: [],
    closed: [],
    dead: [],
  }

  filteredLeads.forEach((lead) => {
    const stage = stationToStage(lead.station)
    if (!stage) return
    const address = [lead.property_address, lead.city].filter(Boolean).join(', ')
    cardsByStage[stage].push({
      id: lead.id,
      initials: getInitials(lead.full_name),
      name: lead.full_name || '(no name)',
      address: address || '(no address)',
      phone: lead.phone,
      email: lead.email,
      personalityType: null,
      stage,
      avatarBg: avatarColor(lead.id),
      timerUrgent: lead.priority === 'hot',
      timerLabel: lead.priority === 'hot' ? '🔥 Hot' : undefined,
      created_at: lead.created_at,
    })
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-on-surface-variant">
        Loading pipeline...
      </div>
    )
  }

  return (
    <>
      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); fetchLeads() }}
        />
      )}
      <div
        className="flex-1 overflow-x-auto overflow-y-hidden flex gap-6 items-start pb-6"
        style={{ height: 'calc(100vh - 260px)' }}
      >
        {columns.map(({ title, stage, number }) => (
          <KanbanColumn
            key={stage}
            title={`${number}. ${title}`}
            stage={stage}
            cards={cardsByStage[stage]}
          />
        ))}
      </div>
    </>
  )
}
