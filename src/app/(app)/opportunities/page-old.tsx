'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { HotOpportunityCard } from '@/components/opportunities/hot-opportunity-card'
import { ActivityTable } from '@/components/opportunities/activity-table'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import { Icon } from '@/components/ui/icon'
import { toProperCase } from '@/lib/format'
import { useHotOpportunities, useRefreshHotList } from '@/hooks/use-hot-opportunities'
import type { Deal, Contact, DealStage } from '@/types'
import type { ManifestV2 } from '@/lib/manifest-builder'

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

function leadToContact(lead: LeadRow): Contact {
  const parts = (toProperCase(lead.full_name) || 'Unknown').split(' ')
  return {
    id: lead.id,
    first_name: parts[0] || 'Unknown',
    last_name: parts.slice(1).join(' ') || '',
    email: lead.email,
    phone: lead.phone,
    address: lead.property_address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    personality_type: null,
    lead_score: lead.priority === 'hot' ? 90 : lead.priority === 'high' ? 75 : 60,
    lead_owner: 'Ernest',
    smart_tags: lead.priority === 'hot' ? ['Hot Lead'] : [],
    current_stage: (lead.station as DealStage) || 'qualifying',
    created_at: lead.created_at,
    updated_at: lead.created_at,
  }
}

function leadToDeal(lead: LeadRow, manifest?: ManifestV2): Deal {
  // REAL financials from manifest (not fabricated)
  const fin = manifest?.financials || {}
  const arv = fin.arv ?? lead.arv ?? null
  const asIs = fin.as_is_value ?? null  // NO MORE fake 0.75 multiplier
  const asking = fin.asking_price ?? manifest?.situation?.priceExpectations?.askingPrice ?? lead.offer_amount ?? null
  const equity = fin.equity ?? null
  const estAssignment = fin.assignment_fee ?? null
  const debtTotal = fin.total_debt ?? null

  // REAL next action from manifest
  const nextAppointment = manifest?.pipeline?.appointment?.scheduledAt ?? null
  const recommendedActions = manifest?.ariIntelligence?.recommendedActions ?? []
  const nextAction = nextAppointment
    ? new Date(nextAppointment).toISOString()
    : recommendedActions[0]?.dateTime ?? null

  // REAL Ari insight from manifest
  const ariInsight = manifest?.ariIntelligence?.lastBriefing?.situation
    ?? manifest?.situation?.summary
    ?? lead.seller_situation
    ?? 'No details yet — visit lead page to add info.'

  // REAL tags from manifest
  const tags: string[] = []
  if (lead.priority === 'hot') tags.push('Hot Lead')
  if (lead.is_favorite) tags.push('⭐ Starred')
  if (manifest?.pipeline?.appointment?.status === 'scheduled' ||
      manifest?.pipeline?.appointment?.status === 'confirmed') {
    tags.push('Appt Set')
  }
  if (manifest?.situation?.type?.length) {
    manifest.situation.type.forEach(t => tags.push(t.replace(/_/g, ' ')))
  }
  if (lead.source) tags.push(lead.source.replace(/_/g, ' '))

  return {
    id: lead.id,
    contact_id: lead.id,
    property_address: lead.property_address,
    stage: (lead.station as DealStage) || 'qualifying',
    arv,
    as_is_value: asIs,
    asking_price: asking,
    equity,
    debt_total: debtTotal,
    est_assignment: estAssignment,
    ari_insight: ariInsight,
    ari_tags: tags,
    created_at: lead.created_at,
    updated_at: lead.updated_at || lead.created_at,
    contact: leadToContact(lead),
    // NEW: pass through for the card to use
    _nextAction: nextAction,
    _qualificationScore: manifest?.qualificationScore ?? null,
    _motivationScore: manifest?.situation?.motivation?.score ?? lead.motivation_score ?? null,
  }
}

export default function OpportunitiesPage() {
  const router = useRouter()
  const [allDeals, setAllDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const { data: hotData, isLoading: hotLoading } = useHotOpportunities()
  const refreshHotList = useRefreshHotList()

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()

    // Fetch ALL active leads (not dead/closed)
    const { data: oppData } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, source, station, priority, notes, created_at, updated_at, is_favorite, arv, offer_amount, repair_estimate, motivation_score, seller_situation, appointment_date')
      .not('station', 'in', '(dead,closed,disposition)')
      .order('updated_at', { ascending: false })

    // Fetch manifests for all leads
    const allLeadIds = (oppData || []).map(l => l.id)
    const { data: allManifests } = allLeadIds.length > 0
      ? await supabase
          .from('manifests')
          .select('lead_id, manifest')
          .in('lead_id', allLeadIds)
      : { data: [] }

    // Build a map for quick lookup
    const manifestMap = new Map<string, ManifestV2>()
    for (const m of (allManifests || [])) {
      manifestMap.set(m.lead_id, m.manifest as ManifestV2)
    }

    // Build deals with real manifest data
    const deals = (oppData || []).map(l => leadToDeal(l, manifestMap.get(l.id)))

    setAllDeals(deals)
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  const totalDeals = allDeals.length

  return (
    <div className="pt-6 pb-32 px-4 sm:px-6 lg:px-8 max-w-[1600px] mx-auto">
      {showAdd && (
        <AddLeadModal
          onClose={() => setShowAdd(false)}
          onSuccess={() => { setShowAdd(false); fetchLeads() }}
        />
      )}

      {/* Header */}
      <header className="mb-8 flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-primary mb-2">Opportunities</h1>
          <p className="text-on-surface-variant text-sm">
            Deals in active qualifying, negotiation, or closing. Double-click any card for full details.
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-on-primary rounded-lg font-medium transition-transform active:scale-95"
        >
          <Icon name="add" size="text-sm" />
          <span>Add Lead</span>
        </button>
      </header>

      {/* Hot Opportunities — Ari's curated shortlist */}
      <section className="mb-10">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <span className="text-lg font-black text-primary">Hot Opportunities</span>
            {hotData?.items && hotData.items.length > 0 && (
              <span className="px-2 py-0.5 bg-orange-100 text-orange-600 text-xs font-bold rounded-full">
                {hotData.items.length} ranked
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {hotData?.lastRankedAt && (
              <span className="text-[11px] text-on-surface-variant/50">
                Last ranked: {new Date(hotData.lastRankedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
            <button
              onClick={() => refreshHotList(true)}
              className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant"
              title="Refresh rankings"
            >
              <Icon name="refresh" size="text-sm" />
            </button>
          </div>
        </div>
        {hotLoading ? (
          <div className="text-slate-400 py-8 text-center text-sm">Scoring opportunities...</div>
        ) : hotData?.items && hotData.items.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-6">
            {hotData.items.map((opp) => (
              <HotOpportunityCard
                key={opp.leadId}
                opp={opp}
                onCall={(phone, leadId) => {
                  // Dispatch dialer event
                  window.dispatchEvent(new CustomEvent('crm:dial', { detail: { phone, leadId } }))
                }}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-8 bg-surface-container-low rounded-xl">
            <p className="text-slate-400 text-sm">No scored opportunities yet. Rankings will appear after leads are scored.</p>
            <button
              onClick={() => refreshHotList(true)}
              className="mt-2 px-3 py-1.5 bg-primary text-on-primary text-xs font-semibold rounded-lg"
            >
              Run Full Ranking
            </button>
          </div>
        )}
      </section>

      {/* Activity Table — recent activity for hot list leads */}
      {hotData?.items && hotData.items.length > 0 && !loading && (
        <ActivityTable deals={allDeals.filter(d => hotData.items!.some(h => h.leadId === d.id))} />
      )}
    </div>
  )
}
