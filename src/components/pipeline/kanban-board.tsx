'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanColumn } from './kanban-column'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import type { KanbanCardData } from './kanban-card'
import type { DealStage } from '@/types'

const columns: { title: string; stage: DealStage }[] = [
  { title: 'New', stage: 'new' },
  { title: 'Not Contacted', stage: 'not_contacted' },
  { title: 'Contacted', stage: 'contacted' },
  { title: 'Qualifying', stage: 'qualifying' },
  { title: 'Appt Set', stage: 'appt_set' },
  { title: 'Negotiations', stage: 'negotiations' },
  { title: 'Contract Signed', stage: 'contract_signed' },
]

function stationToStage(station: string | null): DealStage | null {
  const map: Record<string, DealStage> = {
    intake: 'new',
    not_contacted: 'not_contacted',
    contacted: 'contacted',
    qualifying: 'qualifying',
    appt_set: 'appt_set',
    negotiations: 'negotiations',
    contract_signed: 'contract_signed',
  }
  return station ? (map[station] ?? null) : null
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
    new: [], not_contacted: [], contacted: [],
    qualifying: [], appt_set: [], negotiations: [], contract_signed: [],
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
        {columns.map(({ title, stage }) => (
          <KanbanColumn
            key={stage}
            title={title}
            stage={stage}
            cards={cardsByStage[stage]}
          />
        ))}
      </div>
    </>
  )
}
