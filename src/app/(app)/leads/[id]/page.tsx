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
import { PropertyDetailsCard, type PropertyHousingDetails } from '@/components/leads/property-details-card'
import { SkipTraceStatus, type SkipTraceData } from '@/components/leads/skip-trace-status'
import { ContractStatus, type ContractStatusData } from '@/components/leads/contract-status'
import { TemperatureBadge } from '@/components/leads/temperature-badge'
import { FavoriteToggle } from '@/components/leads/favorite-toggle'
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
  county: string | null
  source: string | null
  station: string | null
  priority: string | null
  notes: string | null
  created_at: string
  is_favorite: boolean | null

  // Housing details (LED-09)
  beds: number | null
  baths_full: number | null
  baths_half: number | null
  sqft: number | null
  lot_size: number | null
  year_built: number | null
  basement_type: string | null
  stories: number | null
  garage_spaces: number | null
  roof_type: string | null
  heating: string | null
  cooling: string | null
  property_type: string | null
  zoning: string | null
  hoa_amount: number | null
  tax_assessment: number | null
  last_sale_date: string | null
  last_sale_price: number | null
  data_source: string | null
  data_enriched_at: string | null
}

interface ActivityRow {
  id: string
  type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

const LETTER_STAGES = ['Queued', 'Written', 'Mailed', 'In Transit', 'Follow-up Set'] as const
type LetterStage = (typeof LETTER_STAGES)[number]

function formatActivityTimestamp(ts: string): string {
  const d = new Date(ts)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHrs = Math.floor(diffMins / 60)
  if (diffHrs < 24) return `${diffHrs}h ago`
  const diffDays = Math.floor(diffHrs / 24)
  if (diffDays < 7) return `${diffDays}d ago`
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function activityTypeToFeedType(type: string): 'sms' | 'call' | 'email' | 'status_change' {
  if (type === 'sms') return 'sms'
  if (type === 'call') return 'call'
  if (type === 'email') return 'email'
  return 'status_change'
}

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [letterStage, setLetterStage] = useState<LetterStage | null>(null)
  const [savingLetter, setSavingLetter] = useState(false)
  const [ghostProtocolStatus, setGhostProtocolStatus] = useState<{ phase: number; status: string } | null>(null)

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

  useEffect(() => {
    async function fetchActivities() {
      const supabase = createClient()
      const { data } = await supabase
        .from('lead_activities')
        .select('id, type, description, agent, metadata, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(50)
      const rows = (data as ActivityRow[]) || []
      setActivities(rows)
      // Restore letter tracking stage from DB
      const letterRow = rows.find((r) => r.type === 'letter_tracking')
      if (letterRow?.metadata?.stage) {
        setLetterStage(letterRow.metadata.stage as LetterStage)
      }
      // Check for Ghost Protocol enrollment
      const ghostRow = rows.find((r) => r.type === 'ghost_protocol_enrollment')
      if (ghostRow?.metadata?.status === 'active') {
        setGhostProtocolStatus({
          phase: ghostRow.metadata.current_phase as number,
          status: ghostRow.metadata.status as string,
        })
      }
    }
    if (id) fetchActivities()
  }, [id])

  async function handleLetterStage(stage: LetterStage) {
    setSavingLetter(true)
    setLetterStage(stage)
    const supabase = createClient()
    const existing = activities.find((a) => a.type === 'letter_tracking')
    if (existing) {
      await supabase
        .from('lead_activities')
        .update({ metadata: { stage }, description: `Letter stage: ${stage}` })
        .eq('id', existing.id)
    } else {
      await supabase.from('lead_activities').insert({
        lead_id: id,
        type: 'letter_tracking',
        description: `Letter stage: ${stage}`,
        agent: 'System',
        metadata: { stage },
      })
    }
    setSavingLetter(false)
  }

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
    city: lead.city || undefined,
    state: lead.state || undefined,
    zip: lead.zip || undefined,
    beds: 0,
    baths: 0,
    sqft: 0,
    yearBuilt: 0,
    lotSize: '—',
    tags: [lead.station || 'intake', lead.priority || 'normal'].filter(Boolean),
  }

  const feedActivities = activities
    .filter((a) => ['sms', 'call', 'email', 'status_change'].includes(a.type))
    .slice(0, 20)
    .map((a) => ({
      id: a.id,
      type: activityTypeToFeedType(a.type),
      title: a.type === 'sms' ? 'SMS' : a.type === 'call' ? 'Phone call' : a.type === 'email' ? 'Email' : 'Status update',
      content: a.description || undefined,
      timestamp: formatActivityTimestamp(a.created_at),
    }))

  const letterStageIdx = letterStage ? LETTER_STAGES.indexOf(letterStage) : -1

  // CIM-01: Track 4 qualification pillars
  const pillarRow = activities.find((a) => a.type === 'pillar_data')
  const pillars = (pillarRow?.metadata || {}) as Record<string, boolean>
  const PILLAR_LABELS = ['TIMELINE', 'CONDITION', 'MOTIVATION', 'PRICE'] as const

  async function togglePillar(pillar: string) {
    const supabase = createClient()
    const current = (pillarRow?.metadata || {}) as Record<string, boolean>
    const updated = { ...current, [pillar]: !current[pillar] }
    if (pillarRow) {
      await supabase.from('lead_activities').update({ metadata: updated }).eq('id', pillarRow.id)
    } else {
      await supabase.from('lead_activities').insert({
        lead_id: id,
        type: 'pillar_data',
        description: 'Qualification pillars',
        agent: 'System',
        metadata: updated,
      })
    }
    // Refresh activities
    const { data } = await supabase
      .from('lead_activities')
      .select('id, type, description, agent, metadata, created_at')
      .eq('lead_id', id)
      .order('created_at', { ascending: false })
      .limit(50)
    setActivities((data as ActivityRow[]) || [])
  }

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 mt-6">
      {/* CIM-01: Critical Info Missing Banner */}
      {PILLAR_LABELS.some((p) => !pillars[p]) && (
        <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-3 flex-wrap">
          <Icon name="warning" className="text-amber-500 shrink-0" />
          <span className="text-sm font-bold text-amber-800">Missing Qualification Data:</span>
          <div className="flex gap-2 flex-wrap">
            {PILLAR_LABELS.map((p) => (
              <button
                key={p}
                onClick={() => togglePillar(p)}
                className={`px-3 py-1 rounded-full text-[11px] font-black uppercase tracking-wide transition-all ${
                  pillars[p]
                    ? 'bg-green-100 text-green-700 border border-green-300'
                    : 'bg-red-100 text-red-700 border border-red-300 hover:bg-red-200'
                }`}
              >
                {pillars[p] ? '✓ ' : '✗ '}{p}
              </button>
            ))}
          </div>
          <span className="text-xs text-amber-600 ml-auto">Click to mark as captured</span>
        </div>
      )}
      {PILLAR_LABELS.every((p) => pillars[p]) && (
        <div className="mb-6 p-3 bg-green-50 border border-green-200 rounded-xl flex items-center gap-2">
          <Icon name="check_circle" className="text-green-500" />
          <span className="text-sm font-bold text-green-800">All 4 qualification pillars captured — ready to advance stage.</span>
        </div>
      )}
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
            {/* TMP-02: Favorite Toggle */}
            <FavoriteToggle
              leadId={lead.id}
              isFavorite={lead.is_favorite ?? false}
              size="lg"
            />
            {/* TMP-03: Temperature Badge */}
            <TemperatureBadge
              lead={{
                priority: lead.priority,
                station: lead.station,
                created_at: lead.created_at,
              }}
              size="lg"
            />
            {ghostProtocolStatus && (
              <div className="px-3 py-1 bg-purple-100 border border-purple-300 rounded-full flex items-center gap-1.5">
                <Icon name="psychology" className="!text-sm text-purple-600" />
                <span className="text-[11px] font-black uppercase tracking-wide text-purple-700">
                  Ghost Protocol Phase {ghostProtocolStatus.phase}
                </span>
              </div>
            )}
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

        {/* CENTER COLUMN: Property, Activity, Letter Tracking */}
        <div className="col-span-12 lg:col-span-6 space-y-8">
          <PropertyHero property={property} />

          {/* LED-05 + LED-06: Property Details Card with 18 fields */}
          <PropertyDetailsCard
            details={{
              beds: lead.beds,
              baths_full: lead.baths_full,
              baths_half: lead.baths_half,
              sqft: lead.sqft,
              lot_size: lead.lot_size,
              year_built: lead.year_built,
              basement_type: lead.basement_type,
              stories: lead.stories,
              garage_spaces: lead.garage_spaces,
              roof_type: lead.roof_type,
              heating: lead.heating,
              cooling: lead.cooling,
              property_type: lead.property_type,
              zoning: lead.zoning,
              hoa_amount: lead.hoa_amount,
              tax_assessment: lead.tax_assessment,
              last_sale_date: lead.last_sale_date,
              last_sale_price: lead.last_sale_price,
              data_source: lead.data_source,
              data_enriched_at: lead.data_enriched_at,
            }}
            address={addressLine}
            onEdit={() => {/* TODO: Open edit modal */}}
          />

          {/* SKP-01: Skip Trace Status */}
          <SkipTraceStatus
            data={{
              last_traced_date: null, // TODO: Pull from skip trace data
              phones: [], // TODO: Pull from skip trace data
            }}
            onRetrace={() => {/* TODO: Trigger skip trace */}}
          />

          {/* DOC-01: Contract Status */}
          <ContractStatus
            data={{
              status: 'none', // TODO: Pull from contract tracking
              // sent_date, viewed_date, signed_date, etc.
            }}
            onSendContract={() => {/* TODO: Open contract generation */}}
          />

          <ActivityFeed activities={feedActivities} />

          {/* Letter Tracking — LED-04 */}
          <section className="bg-surface-container-lowest border border-outline-variant/10 rounded-2xl p-6 shadow-sm">
            <div className="flex items-center justify-between mb-5">
              <h2 className="text-sm font-black uppercase tracking-widest text-primary">
                Letter Tracking
              </h2>
              {savingLetter && (
                <span className="text-xs text-on-surface-variant animate-pulse">Saving...</span>
              )}
            </div>

            {/* Visual pipeline */}
            <div className="flex items-center gap-1 mb-5 overflow-x-auto pb-1">
              {LETTER_STAGES.map((stage, idx) => {
                const isActive = idx <= letterStageIdx
                const isCurrent = stage === letterStage
                return (
                  <div key={stage} className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => handleLetterStage(stage)}
                      className={`flex flex-col items-center gap-1 px-3 py-2 rounded-lg text-[11px] font-bold transition-all ${
                        isCurrent
                          ? 'bg-primary text-white shadow-sm'
                          : isActive
                          ? 'bg-secondary-container text-on-secondary-container'
                          : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                      }`}
                    >
                      <Icon
                        name={
                          idx === 0 ? 'inbox' :
                          idx === 1 ? 'edit' :
                          idx === 2 ? 'send' :
                          idx === 3 ? 'local_shipping' :
                          'check_circle'
                        }
                        size="text-base"
                      />
                      {stage}
                    </button>
                    {idx < LETTER_STAGES.length - 1 && (
                      <div className={`h-0.5 w-4 rounded-full ${isActive && idx < letterStageIdx ? 'bg-secondary' : 'bg-outline-variant/30'}`} />
                    )}
                  </div>
                )
              })}
            </div>

            <p className="text-sm text-on-surface-variant">
              {letterStage
                ? <>Current status: <span className="font-bold text-primary">{letterStage}</span></>
                : 'Click a stage above to track the outreach letter for this lead.'}
            </p>
          </section>
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
