'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { KanbanColumn } from './kanban-column'
import { toProperCase } from '@/lib/format'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import type { KanbanCardData } from './kanban-card'
import type { DealStage } from '@/types'
import { ACQUISITION_STAGES, STAGE_LABELS, normalizeDealStage } from '@/types/pipeline'

const columns: { title: string; stage: DealStage; number: number }[] =
  ACQUISITION_STAGES.map((stage, index) => ({
    title: STAGE_LABELS[stage],
    stage,
    number: index + 1,
  }))

function stationToStage(station: string | null): DealStage | null {
  const normalized = normalizeDealStage(station)
  if (!normalized) return null
  if (!(ACQUISITION_STAGES as readonly string[]).includes(normalized)) return null
  return normalized as DealStage
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
  is_parked: boolean | null
  created_at: string
}

interface ManifestRow {
  lead_id: string
  manifest: {
    pipeline?: {
      appointment?: {
        ghostRiskScore?: number
        status?: string
      }
      ghostProtocol?: {
        status?: string
      }
    }
  }
}

export function KanbanBoard({ onNewLead, showFilters, filterPriority }: {
  onNewLead?: () => void
  showFilters?: boolean
  filterPriority?: string
}) {
  const [leads, setLeads] = useState<Lead[]>([])
  const [manifestMap, setManifestMap] = useState<Record<string, ManifestRow['manifest']>>({})
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()
    const [leadsRes, manifestsRes] = await Promise.all([
      supabase
        .from('leads')
        .select('id, full_name, phone, email, property_address, city, station, priority, is_parked, created_at')
        .in('station', [...ACQUISITION_STAGES])
        .eq('is_parked', false)
        .order('created_at', { ascending: false })
        .limit(500),
      supabase
        .from('manifests')
        .select('lead_id, manifest')
    ])
    setLeads((leadsRes.data as Lead[]) || [])
    const mMap: Record<string, ManifestRow['manifest']> = {}
    for (const row of (manifestsRes.data as ManifestRow[]) || []) {
      if (row.lead_id) mMap[row.lead_id] = row.manifest
    }
    setManifestMap(mMap)
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
    appointment_set: [],
    negotiations: [],
    contract_signed: [],
    offer_made: [],
    under_contract: [],
    disposition: [],
    closed: [],
    closed_won: [],
    closed_lost: [],
    dead: [],
  }

  filteredLeads.forEach((lead) => {
    const stage = stationToStage(lead.station)
    if (!stage) return
    const address = [lead.property_address, lead.city].filter(Boolean).join(', ')
    const m = manifestMap[lead.id]
    const ghostRiskScore = m?.pipeline?.appointment?.ghostRiskScore ?? 0
    const ghostProtocolActive = m?.pipeline?.ghostProtocol?.status === 'active'
    cardsByStage[stage].push({
      id: lead.id,
      initials: getInitials(lead.full_name),
      name: toProperCase(lead.full_name) || '(no name)',
      address: address || '(no address)',
      phone: lead.phone,
      email: lead.email,
      personalityType: null,
      stage,
      avatarBg: avatarColor(lead.id),
      timerUrgent: lead.priority === 'hot',
      timerLabel: lead.priority === 'hot' ? 'Hot' : undefined,
      created_at: lead.created_at,
      ghostRiskScore,
      ghostProtocolActive,
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
