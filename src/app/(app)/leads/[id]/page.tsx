'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { AriBriefing } from '@/components/leads/ari-briefing'
import { PainPoints } from '@/components/leads/pain-points'
import { SellersTimeline } from '@/components/leads/sellers-timeline'
import { FavoriteOrFool } from '@/components/leads/favorite-or-fool'
import { PropertyHero } from '@/components/leads/property-hero'
import { ActivityFeed } from '@/components/leads/activity-feed'
import { PropertyDetailsCard } from '@/components/leads/property-details-card'
import { TemperatureBadge } from '@/components/leads/temperature-badge'
import { TemperatureOverride } from '@/components/leads/temperature-override'
import { FavoriteToggle } from '@/components/leads/favorite-toggle'
import { AddNote } from '@/components/leads/add-note'
import { ContractModal } from '@/components/leads/contract-modal'
import { AppointmentModal } from '@/components/leads/appointment-modal'
import { createClient } from '@/lib/supabase/client'
import { toProperCase, formatPhone } from '@/lib/format'

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
  assigned_agent: string | null
  created_at: string
  is_favorite: boolean | null
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
  arv: number | null
  repair_estimate: number | null
  offer_amount: number | null
  assignment_fee: number | null
  motivation_score: number | null
  seller_situation: string | null
}

interface ActivityRow {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

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

// ─── Net Proceeds Calculator ─────────────────────────────────────────────────
interface NetProceedsCalcProps {
  leadId: string
  initialArv: number | null
  initialRepairs: number | null
  initialAskingPrice: number | null
  initialAssignmentFee: number | null
}

function NetProceedsCalc({ leadId, initialArv, initialRepairs, initialAskingPrice, initialAssignmentFee }: NetProceedsCalcProps) {
  const [arv, setArv] = useState(initialArv ?? 0)
  const [asIsValue, setAsIsValue] = useState(initialAskingPrice ? Math.round(initialAskingPrice * 1.1) : 0)
  const [askingPrice, setAskingPrice] = useState(initialAskingPrice ?? 0)
  const [mortgage, setMortgage] = useState(0)
  const [liens, setLiens] = useState(0)
  const [taxes, setTaxes] = useState(0)
  const [editingField, setEditingField] = useState<string | null>(null)
  const [inputValue, setInputValue] = useState('')

  const totalDebt = mortgage + liens + taxes
  const equitySurplus = asIsValue - totalDebt
  const estimatedAssignment = initialAssignmentFee ?? Math.max(0, Math.round(arv * 0.7 - askingPrice - (initialRepairs || 0)))

  type FieldConfig = { key: string; label: string; value: number; editable: boolean; color?: string }

  const fields: FieldConfig[] = [
    { key: 'arv', label: 'ARV', value: arv, editable: true },
    { key: 'asIs', label: 'As-Is Valuation', value: asIsValue, editable: true },
    { key: 'asking', label: 'Asking Price', value: askingPrice, editable: true },
    { key: 'mortgage', label: 'Mortgage', value: mortgage, editable: true },
    { key: 'liens', label: 'Liens', value: liens, editable: true },
    { key: 'taxes', label: 'Back Taxes', value: taxes, editable: true },
  ]

  async function saveField(key: string, val: number) {
    const supabase = createClient()
    const fieldMap: Record<string, string> = { arv: 'arv', asking: 'offer_amount' }
    const col = fieldMap[key]
    if (!col) return
    await supabase.from('leads').update({ [col]: val }).eq('id', leadId)
  }

  function startEdit(key: string, val: number) {
    setEditingField(key)
    setInputValue(String(val))
  }

  function commitEdit(key: string) {
    const val = parseFloat(inputValue) || 0
    const setterMap: Record<string, (v: number) => void> = {
      arv: setArv, asIs: setAsIsValue, asking: setAskingPrice,
      mortgage: setMortgage, liens: setLiens, taxes: setTaxes,
    }
    setterMap[key]?.(val)
    saveField(key, val)
    setEditingField(null)
  }

  return (
    <section className="bg-[#1B2A4A] rounded-2xl p-6">
      <div className="flex items-center gap-2 mb-5">
        <Icon name="calculate" className="!text-lg text-emerald-400" />
        <h2 className="text-sm font-black uppercase tracking-[0.15em] text-white">
          Net Proceeds Calculator
        </h2>
      </div>

      <div className="space-y-3">
        {fields.map(({ key, label, value, editable }) => (
          <div key={key} className="flex justify-between items-center">
            <span className="text-sm text-slate-400 font-medium">{label}</span>
            {editingField === key ? (
              <input
                autoFocus
                type="number"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onBlur={() => commitEdit(key)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit(key)
                  if (e.key === 'Escape') setEditingField(null)
                }}
                className="w-32 text-right text-sm font-bold text-white bg-white/10 border border-white/20 rounded px-2 py-0.5 focus:outline-none focus:ring-1 focus:ring-amber-400"
              />
            ) : (
              <span
                className={`text-sm font-bold text-white cursor-pointer hover:text-amber-300 transition-colors px-1 ${editable ? '' : ''}`}
                onDoubleClick={() => editable && startEdit(key, value)}
                title={editable ? 'Double-click to edit' : ''}
              >
                ${value.toLocaleString()}
              </span>
            )}
          </div>
        ))}

        {/* Divider */}
        <div className="border-t border-white/10 pt-3 space-y-3">
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400 font-medium">Total Debt</span>
            <span className="text-sm font-bold text-red-400">${totalDebt.toLocaleString()}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-sm text-slate-400 font-medium">Equity / Surplus</span>
            <span className={`text-sm font-bold ${equitySurplus >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              ${equitySurplus.toLocaleString()}
            </span>
          </div>
        </div>

        {/* Assignment Fee - Big Number */}
        <div className="bg-white/5 rounded-xl p-4 mt-2">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400 mb-1">
            Estimated Assignment
          </p>
          <p className="text-3xl font-black text-white leading-none">
            ${estimatedAssignment.toLocaleString()}
          </p>
        </div>
      </div>

      <p className="text-[9px] text-slate-500 mt-3">Double-click any value to edit</p>
    </section>
  )
}

// ─── Edit Lead Slide-Over ─────────────────────────────────────────────────────
interface EditLeadPanelProps {
  lead: Lead
  onClose: () => void
  onSaved: (updated: Partial<Lead>) => void
}

function EditLeadPanel({ lead, onClose, onSaved }: EditLeadPanelProps) {
  const [form, setForm] = useState({
    full_name: lead.full_name ?? '',
    phone: lead.phone ?? '',
    email: lead.email ?? '',
    property_address: lead.property_address ?? '',
    city: lead.city ?? '',
    state: lead.state ?? '',
    zip: lead.zip ?? '',
    county: lead.county ?? '',
    source: lead.source ?? '',
    station: lead.station ?? '',
    priority: lead.priority ?? '',
    notes: lead.notes ?? '',
    assigned_agent: lead.assigned_agent ?? '',
  })
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    const supabase = createClient()
    await supabase.from('leads').update(form).eq('id', lead.id)
    onSaved(form)
    setSaving(false)
    onClose()
  }

  const fields: { key: keyof typeof form; label: string; type?: string; multiline?: boolean }[] = [
    { key: 'full_name', label: 'Full Name' },
    { key: 'phone', label: 'Phone', type: 'tel' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'property_address', label: 'Property Address' },
    { key: 'city', label: 'City' },
    { key: 'state', label: 'State' },
    { key: 'zip', label: 'ZIP' },
    { key: 'county', label: 'County' },
    { key: 'source', label: 'Source' },
    { key: 'station', label: 'Station' },
    { key: 'priority', label: 'Priority' },
    { key: 'assigned_agent', label: 'Assigned Agent' },
    { key: 'notes', label: 'Notes', multiline: true },
  ]

  return (
    <>
      <div className="fixed inset-0 bg-black/30 z-40" onClick={onClose} />
      <div className="fixed right-0 top-0 bottom-0 w-[400px] bg-white shadow-2xl z-50 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <h2 className="text-lg font-bold text-gray-900">Edit Lead</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
            <Icon name="close" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {fields.map(({ key, label, type, multiline }) => (
            <div key={key}>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">{label}</label>
              {multiline ? (
                <textarea
                  rows={4}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              ) : (
                <input
                  type={type ?? 'text'}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              )}
            </div>
          ))}
        </div>
        <div className="px-6 py-4 border-t border-gray-200 flex gap-3">
          <button onClick={onClose} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-lg py-2 text-sm font-bold hover:bg-blue-700 disabled:opacity-50 transition-all">
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [ghostProtocolStatus, setGhostProtocolStatus] = useState<{ phase: number; status: string } | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [thankYouSent, setThankYouSent] = useState(false)
  const [editPanelOpen, setEditPanelOpen] = useState(false)
  const [contractModalOpen, setContractModalOpen] = useState(false)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)

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
        .select('id, activity_type, description, agent, metadata, created_at')
        .eq('lead_id', id)
        .order('created_at', { ascending: false })
        .limit(50)
      const rows = (data as ActivityRow[]) || []
      setActivities(rows)
      const ghostRow = rows.find((r) => r.activity_type === 'ghost_protocol_enrollment')
      if (ghostRow?.metadata?.status === 'active') {
        setGhostProtocolStatus({
          phase: ghostRow.metadata.current_phase as number,
          status: ghostRow.metadata.status as string,
        })
      }
      const letterRow = rows.find(
        (r) => r.activity_type === 'letter_tracking' && (r.metadata as Record<string, unknown>)?.letter_type === 'thank_you'
      )
      if (letterRow) setThankYouSent(true)
    }
    if (id) fetchActivities()
  }, [id])

  async function handleThankYouToggle() {
    if (thankYouSent) return
    const supabase = createClient()
    const { data } = await supabase.from('lead_activities').insert({
      lead_id: id,
      activity_type: 'letter_tracking',
      description: `Thank you letter sent to ${toProperCase(lead?.full_name)}`,
      agent: 'User',
      metadata: { letter_type: 'thank_you', sent_date: new Date().toISOString() },
    }).select('id, activity_type, description, agent, metadata, created_at').single()
    setThankYouSent(true)
    if (data) setActivities(prev => [data as ActivityRow, ...prev])
  }

  function handleNoteAdded(note: ActivityRow) {
    setActivities(prev => [note, ...prev])
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
        <Link href="/leads" className="text-primary hover:underline text-sm">Back to Leads</Link>
      </div>
    )
  }

  const addressLine = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  const formattedName = toProperCase(lead.full_name)
  const formattedPhone = formatPhone(lead.phone)

  const property = {
    address: lead.property_address || '--',
    city: lead.city || undefined,
    state: lead.state || undefined,
    zip: lead.zip || undefined,
    county: lead.county || undefined,
    beds: lead.beds ?? 0,
    baths: (lead.baths_full ?? 0) + (lead.baths_half ? 0.5 : 0),
    sqft: lead.sqft ?? 0,
    yearBuilt: lead.year_built ?? 0,
    lotSize: lead.lot_size ? String(lead.lot_size) : '--',
    tags: [lead.station || 'intake', lead.priority || 'normal'].filter(Boolean),
  }

  // Build feed activities - include notes, appointments, call recordings
  const feedActivities = activities
    .slice(0, 30)
    .map((a) => {
      let link: string | undefined
      let linkLabel: string | undefined
      let recordingUrl: string | undefined

      if (a.activity_type === 'status_change' && a.metadata) {
        const newStation = a.metadata.new_station as string | undefined
        const opportunityStages = ['qualifying', 'appt_set', 'negotiations']
        if (newStation && opportunityStages.includes(newStation)) {
          link = '/opportunities'
          linkLabel = 'View in Hot Opportunities'
        }
      }

      // Check for recording URL in call activities
      if (a.activity_type === 'call' && a.metadata) {
        recordingUrl = (a.metadata.recordingUrl || a.metadata.recording_url || a.metadata.RecordingUrl) as string | undefined
      }

      const typeMap: Record<string, string> = {
        sms: 'SMS',
        call: 'Phone call',
        email: 'Email',
        note: 'Agent Note',
        agent_note: 'Agent Note',
        appointment: 'Appointment',
        contract_sent: 'Contract Sent',
        letter_tracking: 'Mail',
        status_change: 'Status update',
      }

      return {
        id: a.id,
        type: activityTypeToFeedType(a.activity_type),
        title: typeMap[a.activity_type] || a.activity_type.replace(/_/g, ' '),
        content: a.description || undefined,
        timestamp: formatActivityTimestamp(a.created_at),
        link,
        linkLabel,
        recordingUrl,
        rawType: a.activity_type,
      }
    })

  // File checklist items
  const hasCalls = activities.some((a) => a.activity_type === 'call')
  const hasTimeline = !!lead.notes || hasCalls
  const hasCondition = !!(lead.beds || lead.sqft || lead.property_type)
  const hasMotivation = !!(lead.motivation_score || lead.seller_situation)
  const hasPrice = !!(lead.offer_amount || lead.arv)
  const hasFavorable = !!(lead.motivation_score && lead.motivation_score >= 6)

  const checklistItems = [
    { label: 'Timeline', done: hasTimeline, icon: 'schedule' },
    { label: 'Condition', done: hasCondition, icon: 'home' },
    { label: 'Motivation', done: hasMotivation, icon: 'psychology' },
    { label: 'Price', done: hasPrice, icon: 'payments' },
    { label: 'Favorable or Full Price', done: hasFavorable, icon: 'thumb_up' },
  ]

  // Build Zillow and county links
  const zillowUrl = addressLine
    ? `https://www.zillow.com/homes/${encodeURIComponent(addressLine)}`
    : null

  const countyTaxUrl = (() => {
    const county = lead.county?.toLowerCase()
    if (!county) return null
    if (county.includes('johnson')) return 'https://taxbill.jocogov.org/'
    if (county.includes('jackson')) return 'https://jacksoncountygov.com/170/Assessment'
    if (county.includes('clay')) return 'https://www.claycountymo.tax/'
    if (county.includes('platte')) return 'https://www.co.platte.mo.us/assessor'
    if (county.includes('wyandotte')) return 'https://www.wycokck.org/Departments/Appraiser'
    return null
  })()

  return (
    <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 mt-6 pb-20">
      {/* Lead Header */}
      <div className="mb-6 flex flex-col sm:flex-row sm:justify-between sm:items-end gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 sm:gap-3 mb-1 flex-wrap">
            <Link href="/leads" className="text-on-surface-variant hover:text-primary transition-colors shrink-0">
              <Icon name="arrow_back" size="text-xl" />
            </Link>
            <h1 className="text-2xl sm:text-3xl lg:text-4xl font-black text-primary tracking-tight break-words">
              {formattedName || 'Unknown'}
            </h1>
            <FavoriteToggle leadId={lead.id} isFavorite={lead.is_favorite ?? false} size="lg" />
            <TemperatureBadge
              lead={{ priority: lead.priority, station: lead.station, created_at: lead.created_at }}
              size="lg"
            />
            <TemperatureOverride
              leadId={lead.id}
              currentPriority={lead.priority}
              onChanged={(p) => setLead(prev => prev ? { ...prev, priority: p } : prev)}
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

          <div className="flex items-center gap-3 flex-wrap ml-0 sm:ml-9">
            <p className="text-on-surface-variant flex items-center gap-2 text-sm">
              <Icon name="location_on" size="text-sm" />
              <span className="break-words">{addressLine || '--'}</span>
            </p>
            {lead.phone && (
              <a
                href={`tel:${lead.phone}`}
                className="flex items-center gap-1.5 px-3 py-1 bg-green-500 hover:bg-green-600 text-white rounded-full text-sm font-bold transition-colors"
              >
                <Icon name="phone" size="text-sm" />
                {formattedPhone}
              </a>
            )}
          </div>
        </div>

        <div className="flex gap-2 sm:gap-3 flex-wrap sm:flex-nowrap shrink-0">
          <button
            onClick={() => setAppointmentModalOpen(true)}
            className="bg-surface-container-lowest border border-outline-variant/15 px-4 py-2.5 rounded-lg font-bold text-on-surface-variant hover:bg-surface-container-low transition-all text-sm flex items-center gap-1.5"
          >
            <Icon name="calendar_month" size="text-sm" />
            Schedule
          </button>
          <button
            onClick={() => setEditPanelOpen(true)}
            className="bg-surface-container-lowest border border-outline-variant/15 px-4 sm:px-6 py-2.5 rounded-lg font-bold text-primary hover:bg-surface-container-low transition-all text-sm sm:text-base"
          >
            Edit Lead
          </button>
          <button
            onClick={() => setContractModalOpen(true)}
            className="bg-secondary text-on-secondary px-4 sm:px-6 py-2.5 rounded-lg font-bold hover:opacity-90 transition-all flex items-center gap-2 text-sm sm:text-base whitespace-nowrap"
          >
            <Icon name="bolt" />
            <span className="hidden sm:inline">Generate Contract</span>
            <span className="sm:hidden">Contract</span>
          </button>
        </div>
      </div>

      {/* Thank You Letter + Quick Links */}
      <div className="mb-6 flex flex-wrap gap-2">
        <button
          onClick={handleThankYouToggle}
          disabled={thankYouSent}
          className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold border transition-all ${
            thankYouSent
              ? 'bg-green-50 border-green-300 text-green-700 cursor-default'
              : 'bg-surface-container-lowest border-outline-variant/20 text-on-surface-variant hover:bg-surface-container-low'
          }`}
        >
          <Icon name={thankYouSent ? 'check_circle' : 'mail'} size="text-base" className={thankYouSent ? 'text-green-500' : ''} />
          <span>Thank you letter sent</span>
        </button>
        {zillowUrl && (
          <a
            href={zillowUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low transition-all"
          >
            <Icon name="open_in_new" size="text-sm" />
            View on Zillow
          </a>
        )}
        {countyTaxUrl && (
          <a
            href={countyTaxUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold border border-outline-variant/20 bg-surface-container-lowest text-on-surface-variant hover:bg-surface-container-low transition-all"
          >
            <Icon name="account_balance" size="text-sm" />
            County Tax Record
          </a>
        )}
      </div>

      {/* 3-Column Layout */}
      <div className="grid grid-cols-12 gap-4 sm:gap-6 lg:gap-8">
        {/* LEFT COLUMN: Ari Briefing, Pain Points, Sellers Timeline */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <AriBriefing
            leadId={lead.id}
            personalityType={null}
            tacticalApproach={lead.notes || null}
            notes={lead.notes}
            sellerSituation={lead.seller_situation}
            motivationScore={lead.motivation_score}
            activities={activities}
          />

          <PainPoints
            leadId={lead.id}
            notes={lead.notes}
            sellerSituation={lead.seller_situation}
            motivationScore={lead.motivation_score}
            activities={activities}
          />

          <SellersTimeline
            leadCreatedAt={lead.created_at}
            station={lead.station}
            activities={activities}
          />
        </div>

        {/* CENTER COLUMN: Property, Notes, Activity */}
        <div className="col-span-12 lg:col-span-6 space-y-6">
          <PropertyHero
            property={property}
            detailsExpanded={detailsExpanded}
            onToggleDetails={() => setDetailsExpanded((v) => !v)}
          />

          {detailsExpanded && (
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
              onEdit={() => setEditPanelOpen(true)}
            />
          )}

          {/* Add Note */}
          <AddNote leadId={lead.id} onNoteAdded={handleNoteAdded} />

          {/* Activity Feed with recording support */}
          <div>
            <ActivityFeed activities={feedActivities} />
            <div className="mt-3 text-right">
              <Link
                href={`/conversations?lead=${id}`}
                className="text-sm text-primary font-bold hover:underline"
              >
                View in Conversations
              </Link>
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Favorite or Fool, Net Proceeds, File Checklist */}
        <div className="col-span-12 lg:col-span-3 space-y-6">
          <FavoriteOrFool
            leadId={lead.id}
            motivationScore={lead.motivation_score}
            arv={lead.arv}
            offerAmount={lead.offer_amount}
            repairEstimate={lead.repair_estimate}
            station={lead.station}
            notes={lead.notes}
            sellerSituation={lead.seller_situation}
          />

          <NetProceedsCalc
            leadId={id}
            initialArv={lead.arv}
            initialRepairs={lead.repair_estimate}
            initialAskingPrice={lead.offer_amount}
            initialAssignmentFee={lead.assignment_fee}
          />

          {/* Missing Information Checklist */}
          <div className="bg-blue-600 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Icon name="checklist" className="text-white" />
              <h3 className="text-sm font-black uppercase tracking-wider text-white">Missing Information</h3>
            </div>
            <ul className="space-y-2.5">
              {checklistItems.map((item) => (
                <li key={item.label} className="flex items-center gap-3 text-sm">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${item.done ? 'bg-green-400' : 'bg-white/20'}`}>
                    {item.done
                      ? <Icon name="check" className="!text-xs text-white" />
                      : <Icon name={item.icon} className="!text-[10px] text-white/50" />
                    }
                  </div>
                  <span className={item.done ? 'text-white font-semibold' : 'text-white/60'}>{item.label}</span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-white/40 mt-4">Auto-updated as data is received</p>
          </div>
        </div>
      </div>

      {/* Modals */}
      {editPanelOpen && (
        <EditLeadPanel
          lead={lead}
          onClose={() => setEditPanelOpen(false)}
          onSaved={(updated) => setLead((prev) => prev ? { ...prev, ...updated } : prev)}
        />
      )}
      {contractModalOpen && (
        <ContractModal
          lead={lead}
          onClose={() => setContractModalOpen(false)}
          onSuccess={() => {
            // Refresh activities
            const supabase = createClient()
            supabase
              .from('lead_activities')
              .select('id, activity_type, description, agent, metadata, created_at')
              .eq('lead_id', id)
              .order('created_at', { ascending: false })
              .limit(50)
              .then(({ data }) => { if (data) setActivities(data as ActivityRow[]) })
          }}
        />
      )}
      {appointmentModalOpen && (
        <AppointmentModal
          lead={lead}
          onClose={() => setAppointmentModalOpen(false)}
          onSuccess={() => {
            const supabase = createClient()
            supabase
              .from('lead_activities')
              .select('id, activity_type, description, agent, metadata, created_at')
              .eq('lead_id', id)
              .order('created_at', { ascending: false })
              .limit(50)
              .then(({ data }) => { if (data) setActivities(data as ActivityRow[]) })
          }}
        />
      )}
    </div>
  )
}
