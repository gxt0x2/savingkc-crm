'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { OpportunityCard } from '@/components/opportunities/opportunity-card'
import { ActivityTable } from '@/components/opportunities/activity-table'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import { Icon } from '@/components/ui/icon'
import { toProperCase } from '@/lib/format'
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
  const [hotDeals, setHotDeals] = useState<Deal[]>([])
  const [otherDeals, setOtherDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [pinning, setPinning] = useState<string | null>(null)

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()

    // Fetch 1: Hot Opportunities (max 4, pinned by user)
    const { data: hotData } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, source, station, priority, notes, created_at, updated_at, is_favorite, arv, offer_amount, repair_estimate, motivation_score, seller_situation, appointment_date')
      .eq('priority', 'hot')
      .order('updated_at', { ascending: false })
      .limit(4)

    // Fetch 2: All Opportunities (active pipeline, NOT hot)
    const { data: oppData } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, source, station, priority, notes, created_at, updated_at, is_favorite, arv, offer_amount, repair_estimate, motivation_score, seller_situation, appointment_date')
      .in('station', ['qualifying', 'appt_set', 'negotiations', 'offer_made', 'contract_signed'])
      .neq('priority', 'hot')
      .order('updated_at', { ascending: false })

    // Fetch 3: Manifests for ALL of the above leads
    const allLeadIds = [...(hotData || []), ...(oppData || [])].map(l => l.id)
    const { data: allManifests } = await supabase
      .from('manifests')
      .select('lead_id, manifest')
      .in('lead_id', allLeadIds)

    // Build a map for quick lookup
    const manifestMap = new Map<string, ManifestV2>()
    for (const m of (allManifests || [])) {
      manifestMap.set(m.lead_id, m.manifest as ManifestV2)
    }

    // Build deals with real manifest data
    const hot = (hotData || []).map(l => leadToDeal(l, manifestMap.get(l.id)))
    const other = (oppData || []).map(l => leadToDeal(l, manifestMap.get(l.id)))

    setHotDeals(hot)
    setOtherDeals(other)
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  async function togglePin(dealId: string, currentPriority: string | null) {
    const isPinning = currentPriority !== 'hot'

    // Block pinning if already at capacity
    if (isPinning && hotDeals.length >= 4) {
      alert('Hot Opportunities is full (4/4). Unpin an existing deal first.')
      return
    }

    setPinning(dealId)
    const newPriority = currentPriority === 'hot' ? 'warm' : 'hot'

    // Call API endpoint to update priority through manifest-sync
    await fetch('/api/leads', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: dealId, priority: newPriority }),
    })
    await fetchLeads()
    setPinning(null)
  }

  // Sort otherDeals by qualification score (highest first)
  const sortedOtherDeals = [...otherDeals].sort((a, b) => {
    // Primary: qualification score (highest first)
    const qA = a._qualificationScore ?? 0
    const qB = b._qualificationScore ?? 0
    if (qB !== qA) return qB - qA

    // Secondary: motivation score (highest first)
    const mA = a._motivationScore ?? 0
    const mB = b._motivationScore ?? 0
    if (mB !== mA) return mB - mA

    // Tertiary: most recently updated
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
  })

  const totalDeals = hotDeals.length + otherDeals.length

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
            Deals in active qualifying, negotiation, or closing. Double-click any card for full details. Pin up to 4 hot deals closing this week.
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

      {loading ? (
        <div className="text-slate-400 py-16 text-center">Loading opportunities...</div>
      ) : totalDeals === 0 ? (
        <div className="text-center py-16">
          <Icon name="work" className="text-4xl text-slate-300 mb-3" />
          <p className="text-slate-400 font-medium">No active opportunities</p>
          <p className="text-slate-400 text-sm mt-1">Move leads to qualifying or negotiations stage to see them here.</p>
          <button onClick={() => setShowAdd(true)} className="mt-4 px-4 py-2 bg-primary text-white text-sm font-semibold rounded-lg">
            Add a lead
          </button>
        </div>
      ) : (
        <>
          {/* Top Hot Deals section */}
          <section className="mb-10">
            <div className="flex items-center gap-3 mb-4">
              <span className="text-lg font-black text-primary">🔥 Hot Opportunities</span>
              <span className={`px-2 py-0.5 text-xs font-bold rounded-full ${hotDeals.length >= 4 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
                {hotDeals.length}/4 slots
              </span>
            </div>
            {hotDeals.length === 0 ? (
              <div className="bg-surface-container-lowest rounded-xl p-12 text-center border border-outline-variant/20">
                <div className="text-4xl mb-4">🔥</div>
                <h3 className="text-lg font-bold text-primary mb-2">No Hot Opportunities pinned</h3>
                <p className="text-on-surface-variant text-sm max-w-md mx-auto">
                  Pin up to 4 deals that are closing this week from All Opportunities below.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {hotDeals.map((deal) => (
                  <div
                    key={deal.id}
                    onDoubleClick={() => router.push(`/leads/${deal.contact?.id}`)}
                    className="relative group"
                  >
                    <button
                      onClick={() => togglePin(deal.id, 'hot')}
                      disabled={pinning === deal.id}
                      title="Unpin from Top Hot Deals"
                      className="absolute top-3 right-3 z-10 p-1.5 bg-red-50 hover:bg-red-100 rounded-lg transition-colors text-red-500 opacity-0 group-hover:opacity-100"
                    >
                      <Icon name="push_pin" size="text-sm" />
                    </button>
                    <OpportunityCard deal={deal} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* All Other Opportunities */}
          <section className="mb-16">
            {hotDeals.length > 0 && otherDeals.length > 0 && (
              <div className="flex items-center gap-3 mb-4">
                <span className="text-base font-bold text-on-surface-variant">All Opportunities</span>
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-6">
              {otherDeals.map((deal) => (
                <div
                  key={deal.id}
                  onDoubleClick={() => router.push(`/leads/${deal.contact?.id}`)}
                  className="relative group"
                >
                  <button
                    onClick={() => togglePin(deal.id, null)}
                    disabled={pinning === deal.id}
                    title="Pin to Top Hot Deals"
                    className="absolute top-3 right-3 z-10 p-1.5 bg-white hover:bg-orange-50 rounded-lg transition-colors text-slate-300 hover:text-orange-500 shadow-sm opacity-0 group-hover:opacity-100"
                  >
                    <Icon name="push_pin" size="text-sm" />
                  </button>
                  <OpportunityCard deal={deal} />
                </div>
              ))}
            </div>
          </section>
        </>
      )}

      {/* Activity Table */}
      <ActivityTable
        deals={sortedOtherDeals}
        onPinToHot={(id) => togglePin(id, null)}
        hotCount={hotDeals.length}
      />
    </div>
  )
}
