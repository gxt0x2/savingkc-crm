'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { OpportunityCard } from '@/components/opportunities/opportunity-card'
import { ActivityTable } from '@/components/opportunities/activity-table'
import { AddLeadModal } from '@/components/leads/add-lead-modal'
import { Icon } from '@/components/ui/icon'
import type { Deal, Contact, DealStage } from '@/types'

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
}

function leadToContact(lead: LeadRow): Contact {
  const parts = (lead.full_name || 'Unknown').split(' ')
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

function leadToDeal(lead: LeadRow): Deal {
  return {
    id: lead.id,
    contact_id: lead.id,
    property_address: lead.property_address,
    stage: (lead.station as DealStage) || 'qualifying',
    arv: null,
    as_is_value: null,
    asking_price: null,
    equity: null,
    debt_total: null,
    est_assignment: null,
    ari_insight: lead.notes || null,
    ari_tags: lead.priority === 'hot' ? ['Hot Lead'] : lead.source ? [lead.source.replace(/_/g, ' ')] : [],
    created_at: lead.created_at,
    updated_at: lead.created_at,
    contact: leadToContact(lead),
  }
}

export default function OpportunitiesPage() {
  const router = useRouter()
  const [deals, setDeals] = useState<Deal[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [pinning, setPinning] = useState<string | null>(null)

  async function fetchLeads() {
    setLoading(true)
    const supabase = createClient()
    const { data } = await supabase
      .from('leads')
      .select('id, full_name, phone, email, property_address, city, state, zip, source, station, priority, notes, created_at')
      .in('station', ['qualifying', 'negotiations'])
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false })
    const rows = (data as LeadRow[]) || []
    setDeals(rows.map(leadToDeal))
    setLoading(false)
  }

  useEffect(() => { fetchLeads() }, [])

  async function togglePin(dealId: string, currentPriority: string | null) {
    setPinning(dealId)
    const supabase = createClient()
    const newPriority = currentPriority === 'hot' ? 'normal' : 'hot'
    await supabase.from('leads').update({ priority: newPriority }).eq('id', dealId)
    await fetchLeads()
    setPinning(null)
  }

  const hotDeals = deals.filter((d) => d.contact?.smart_tags?.includes('Hot Lead'))
  const otherDeals = deals.filter((d) => !d.contact?.smart_tags?.includes('Hot Lead'))

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
          <h1 className="text-3xl font-bold tracking-tight text-primary mb-2">Hot Opportunities</h1>
          <p className="text-on-surface-variant text-sm">
            Leads in qualifying &amp; negotiations. Double-click any card for full details. Use the pin button to mark Top Hot deals.
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
      ) : deals.length === 0 ? (
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
          {hotDeals.length > 0 && (
            <section className="mb-10">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-lg font-black text-primary">🔥 Top Hot Deals</span>
                <span className="px-2 py-0.5 bg-red-100 text-red-600 text-xs font-bold rounded-full">
                  {hotDeals.length} pinned
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-[repeat(auto-fill,minmax(380px,1fr))] gap-6">
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
            </section>
          )}

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
      <ActivityTable />
    </div>
  )
}
