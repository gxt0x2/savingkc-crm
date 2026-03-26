'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { AriBriefing } from '@/components/leads/ari-briefing'
import { PainPoints } from '@/components/leads/pain-points'
import { PropertyHero } from '@/components/leads/property-hero'
import { ActivityFeed } from '@/components/leads/activity-feed'
import { MarketComps } from '@/components/leads/market-comps'
import { NetProceeds } from '@/components/leads/net-proceeds'
import { createClient } from '@/lib/supabase/client'

interface Lead {
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

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchLead() {
      const supabase = createClient()
      const { data } = await supabase
        .from('leads')
        .select('*')
        .eq('id', id)
        .limit(1)
        .single()
      setLead(data as Lead)
      setLoading(false)
    }
    if (id) fetchLead()
  }, [id])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32 text-slate-400">
        Loading lead...
      </div>
    )
  }

  if (!lead) {
    return (
      <div className="flex flex-col items-center justify-center py-32 gap-4">
        <p className="text-slate-500 font-medium">Lead not found</p>
        <Link href="/leads" className="text-primary hover:underline text-sm">
          ← Back to Leads
        </Link>
      </div>
    )
  }

  const addressLine = [
    lead.property_address,
    lead.city,
    lead.state,
    lead.zip,
  ]
    .filter(Boolean)
    .join(', ')

  const property = {
    address: lead.property_address || '—',
    beds: 0,
    baths: 0,
    sqft: 0,
    yearBuilt: 0,
    lotSize: '—',
    tags: [lead.station || 'intake', lead.priority || 'normal'].filter(Boolean),
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 mt-6">
      {/* Lead Header */}
      <div className="mb-8 flex justify-between items-end">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <Link
              href="/leads"
              className="text-on-surface-variant hover:text-primary transition-colors"
            >
              <Icon name="arrow_back" size="text-xl" />
            </Link>
            <h1 className="text-4xl font-black text-primary tracking-tight">
              {lead.full_name || 'Unknown'}
            </h1>
          </div>
          <p className="text-on-surface-variant flex items-center gap-2 ml-9">
            <Icon name="location_on" size="text-sm" />
            {addressLine || '—'}
          </p>
        </div>

        <div className="flex gap-3">
          <button className="bg-surface-container-lowest border border-outline-variant/15 px-6 py-2.5 rounded-lg font-bold text-primary hover:bg-surface-container-low transition-all">
            Edit Lead
          </button>
          <button className="bg-secondary text-on-secondary px-6 py-2.5 rounded-lg font-bold hover:opacity-90 transition-all flex items-center gap-2">
            <Icon name="bolt" />
            Generate Contract
          </button>
        </div>
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-12 gap-8">
        {/* LEFT COLUMN: Ari AI & Pain Points */}
        <div className="col-span-12 lg:col-span-3 space-y-8">
          <AriBriefing
            personalityType="assertive"
            tacticalApproach={
              lead.notes ||
              'No notes yet. Add notes to build a tactical approach for this lead.'
            }
          />
          <PainPoints painPoints={[]} />
        </div>

        {/* CENTER COLUMN: Property & Activity */}
        <div className="col-span-12 lg:col-span-6 space-y-8">
          <PropertyHero property={property} />
          <ActivityFeed activities={[]} />
        </div>

        {/* RIGHT COLUMN: Comps & Calculator */}
        <div className="col-span-12 lg:col-span-3 space-y-8">
          <MarketComps comps={[]} totalComps={0} />
          <NetProceeds
            arv={0}
            asIsValue={0}
            askingPrice={0}
            totalDebt={0}
            equitySurplus={0}
            estAssignment={0}
          />
        </div>
      </div>
    </div>
  )
}
