'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { createClient } from '@/lib/supabase/client'
import { toProperCase } from '@/lib/format'
import { LeadWorkspace } from '@/components/leads/lead-workspace'
import { normalizeLeadRecordingActivities } from '@/lib/lead-recording-activities'
import type { CrmEntityContext } from '@/lib/server/crm-entity-foundation'

const AriBriefing = dynamic(() => import('@/components/leads/ari-briefing').then((module) => module.AriBriefing))
const PainPoints = dynamic(() => import('@/components/leads/pain-points').then((module) => module.PainPoints))
const FavoriteOrFool = dynamic(() => import('@/components/leads/favorite-or-fool').then((module) => module.FavoriteOrFool))
const PropertyHero = dynamic(() => import('@/components/leads/property-hero').then((module) => module.PropertyHero))
const ActivityFeed = dynamic(() => import('@/components/leads/activity-feed').then((module) => module.ActivityFeed))
const DocumentManager = dynamic(() => import('@/components/documents/document-manager').then((module) => module.DocumentManager))
const PropertyDetailsCard = dynamic(() => import('@/components/leads/property-details-card').then((module) => module.PropertyDetailsCard))
const AdsSignalReceipt = dynamic(() => import('@/components/leads/ads-signal-receipt').then((module) => module.AdsSignalReceipt))
const AddNote = dynamic(() => import('@/components/leads/add-note').then((module) => module.AddNote))
const EditNoteModal = dynamic(() => import('@/components/leads/edit-note-modal').then((module) => module.EditNoteModal))
const ContractModal = dynamic(() => import('@/components/leads/contract-modal').then((module) => module.ContractModal))
const AppointmentModal = dynamic(() => import('@/components/leads/appointment-modal').then((module) => module.AppointmentModal))
const AppointmentOutcomeModal = dynamic(() => import('@/components/leads/appointment-outcome-modal').then((module) => module.AppointmentOutcomeModal))
const SmsComposeModal = dynamic(() => import('@/components/leads/sms-compose-modal').then((module) => module.SmsComposeModal))
const DiscoveryQuestions = dynamic(() => import('@/components/leads/discovery-questions').then((module) => module.DiscoveryQuestions))
const MailTracker = dynamic(() => import('@/components/leads/mail-tracker').then((module) => module.MailTracker))
const EmailThread = dynamic(() => import('@/components/leads/email-thread').then((module) => module.EmailThread))
const CockpitModal = dynamic(() => import('@/components/ui/cockpit-modal').then((module) => module.CockpitModal))
const NewTaskModal = dynamic(() => import('@/components/modals/new-task-modal').then((module) => module.NewTaskModal))
const EditTaskModal = dynamic(() => import('@/components/modals/edit-task-modal').then((module) => module.EditTaskModal))
const LeadAiChangeReview = dynamic(() => import('@/components/ai/lead-ai-change-review').then((module) => module.LeadAiChangeReview))

type LeadTriageValue = 'opportunity' | 'lead' | 'dead'


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
  classification: LeadTriageValue | null
  opportunity_score: number | null
  dead_reason?: string | null
  dead_at?: string | null
  dead_by?: string | null
  entityContext?: CrmEntityContext | null
  manifest?: ManifestPanelData | null
  manifestId?: string | null
  manifestUpdatedAt?: string | null
  manifestIntelligenceSource?: 'manifest_compatibility' | null
}

interface ActivityRow {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface AppointmentState {
  appointmentId: string | null
  type: string | null
  scheduledAt: string
  status: string
  assignedTo: string | null
  address: string | null
  notes: string | null
  source?: string | null
}

interface ManifestTaxCollector {
  totalOwed?: number | null
  delinquentAmount?: number | null
  firstDelinquentYear?: number | string | null
  firstYearDelinquent?: number | string | null
  delinquentSince?: number | string | null
  oldestDelinquentYear?: number | string | null
  yearsDelinquent?: number | null
}

interface ManifestAssessment {
  totalValue?: number | null
  source?: string | null
  fetchedAt?: string | null
}

interface ManifestProperty {
  beds?: number | null
  baths_full?: number | null
  bathsFull?: number | null
  baths_half?: number | null
  bathsHalf?: number | null
  sqft?: number | null
  squareFeet?: number | null
  lot_size?: number | null
  lotSize?: number | null
  year_built?: number | null
  yearBuilt?: number | null
  basement_type?: string | null
  basement?: string | null
  stories?: number | null
  garage_spaces?: number | null
  garage?: number | null
  roof_type?: string | null
  roof?: string | null
  heating?: string | null
  cooling?: string | null
  property_type?: string | null
  propertyType?: string | null
  zoning?: string | null
  hoa_amount?: number | null
  tax_assessment?: number | null
  assessment?: ManifestAssessment | null
  taxCollector?: ManifestTaxCollector | null
  last_sale_date?: string | null
  lastSaleDate?: string | null
  last_sale_price?: number | null
  lastSalePrice?: number | null
  data_source?: string | null
  data_enriched_at?: string | null
}

function activityTypeToFeedType(type: string): 'sms' | 'call' | 'email' | 'status_change' {
  if (type === 'sms') return 'sms'
  if (type === 'call') return 'call'
  if (type === 'email') return 'email'
  return 'status_change'
}

function readObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

const CALLER_ID_BY_AGENT: Record<string, string> = {
  ernest: '+18166088588',
  casey: '+18167277667',
}

function callerIdForAssignedAgent(assignedAgent: string | null | undefined): string | undefined {
  const normalized = (assignedAgent || '').toLowerCase()
  if (!normalized) return undefined
  if (normalized.includes('casey')) return CALLER_ID_BY_AGENT.casey
  if (normalized.includes('ernest')) return CALLER_ID_BY_AGENT.ernest
  return undefined
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
    notes: lead.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const dialogRef = useDialogAccessibility<HTMLDivElement>(true, onClose)

  async function handleSave() {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch('/api/leads', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: lead.id, ...form }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Lead could not be saved')
      }
      onSaved(data.lead || form)
      onClose()
    } catch (err: unknown) {
      setSaveError(err instanceof Error ? err.message : 'Lead could not be saved')
    } finally {
      setSaving(false)
    }
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
    { key: 'notes', label: 'Notes', multiline: true },
  ]

  return (
    <>
      <div className="fixed inset-0 z-40 bg-[#111827]/45 backdrop-blur-[1px]" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="edit-lead-title"
        tabIndex={-1}
        className="fixed bottom-0 right-0 top-0 z-50 flex w-full max-w-[430px] flex-col overflow-hidden border-l border-[#d9dfe6] bg-white shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[#e4e7ec] px-6 py-4">
          <div className="flex items-center gap-2">
            <Icon name="edit" className="!text-base text-[#df3038]" />
            <h2 id="edit-lead-title" className="text-lg font-bold text-[#172033]">Edit lead</h2>
          </div>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-[#f2f4f7] text-[#475467] transition-colors hover:bg-[#fff1f2] hover:text-[#b91c26]"
            aria-label="Close edit lead"
          >
            <Icon name="close" className="!text-base" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {fields.map(({ key, label, type, multiline }) => (
            <div key={key}>
              <label
                htmlFor={`edit-lead-${key}`}
                className="mb-1 block text-[10px] font-black uppercase tracking-[0.08em] text-[#667085]"
              >
                {label}
              </label>
              {multiline ? (
                <textarea
                  id={`edit-lead-${key}`}
                  rows={4}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-[#ccd4dd] bg-white px-3 py-2 text-sm text-[#172033] outline-none focus:border-[#df3038]"
                />
              ) : (
                <input
                  id={`edit-lead-${key}`}
                  type={type ?? 'text'}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  className="w-full rounded-lg border border-[#ccd4dd] bg-white px-3 py-2 text-sm text-[#172033] outline-none focus:border-[#df3038]"
                />
              )}
            </div>
          ))}
          {saveError ? <p role="alert" className="rounded-md bg-[#fff1f2] p-3 text-sm font-semibold text-[#b91c26]">{saveError}</p> : null}
        </div>
        <div className="flex gap-3 border-t border-[#e4e7ec] px-6 py-4">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#ccd4dd] bg-white py-2 text-sm font-bold text-[#344054] transition-all hover:bg-[#f7f8fa]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 rounded-lg bg-[#df3038] py-2 text-sm font-bold text-white transition-all hover:bg-[#c9232d] disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>
    </>
  )
}

interface ManifestPanelData {
  manifestId?: string
  version?: number | string
  currentStation?: string
  priority?: string
  tier?: string
  qualificationScore?: number
  owner?: {
    fullName?: string
    coOwners?: unknown
    deceased?: boolean
    outOfState?: boolean
  }
  situation?: {
    type?: unknown
    motivation?: { signals?: unknown }
  }
  property?: {
    vacant?: boolean
    parcel?: string
    legalDescription?: string
    legal_description?: string
    taxCollector?: {
      totalOwed?: number | null
      delinquentAmount?: number | null
    }
  }
  financials?: Record<string, unknown>
  pipeline?: Record<string, unknown>
  communications?: Record<string, unknown>
  flags?: {
    redFlags?: unknown
    opportunityFlags?: unknown
  }
  [key: string]: unknown
}

// ─── Main Page ─────────────────────────────────────────────────────────────────
export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [lead, setLead] = useState<Lead | null>(null)
  const [loading, setLoading] = useState(true)
  const loadedLeadIdRef = useRef<string | null>(null)
  const [activities, setActivities] = useState<ActivityRow[]>([])
  const [manifestRowId, setManifestRowId] = useState<string | null>(null)
  const [manifestProperty, setManifestProperty] = useState<ManifestProperty | null>(null)
  const [zestimate, setZestimate] = useState<number | null>(null)
  const [assessedValue, setAssessedValue] = useState<number | null>(null)
  const [redfinEstimate, setRedfinEstimate] = useState<number | null>(null)
  const [zillowEnriching, setZillowEnriching] = useState(false)
  const [redfinEnriching, setRedfinEnriching] = useState(false)
  const [redfinError, setRedfinError] = useState<string | null>(null)
  const [detailsExpanded, setDetailsExpanded] = useState(false)
  const [editPanelOpen, setEditPanelOpen] = useState(false)
  const [contractModalOpen, setContractModalOpen] = useState(false)
  const [appointmentModalOpen, setAppointmentModalOpen] = useState(false)
  const [showNewTask, setShowNewTask] = useState(false)
  const [outcomeModalOpen, setOutcomeModalOpen] = useState(false)
  const [manifestAppointment, setManifestAppointment] = useState<AppointmentState | null>(null)
  const [nextAppointment, setNextAppointment] = useState<AppointmentState | null>(null)
  const [manifestScore, setManifestScore] = useState<number | null>(null)
  const [manifestTranscripts, setManifestTranscripts] = useState<Array<{ date: string; recordingUrl?: string }>>([])
  const [notesModalOpen, setNotesModalOpen] = useState(false)
  const notesDialogRef = useDialogAccessibility<HTMLDivElement>(
    notesModalOpen,
    () => setNotesModalOpen(false),
  )
  const [smsModalOpen, setSmsModalOpen] = useState(false)
  const [composeTab, setComposeTab] = useState<'sms' | 'email'>('sms')
  const [editNoteId, setEditNoteId] = useState<string | null>(null)
  const [editNoteContent, setEditNoteContent] = useState('')
  const [editTaskId, setEditTaskId] = useState<string | null>(null)
  const [editTaskTitle, setEditTaskTitle] = useState('')
  const [editTaskMetadata, setEditTaskMetadata] = useState<Record<string, unknown>>({})
  const activeAppointment = nextAppointment ?? manifestAppointment

  // ── Data fetching (runs on mount + after user actions) ──
  const [refreshTick, setRefreshTick] = useState(0)

  // Call this after any user action that changes data (note, call, edit, email, etc.)
  const refreshAll = useCallback(() => {
    setRefreshTick(t => t + 1)
    // Fan out to every sub-card (AriBriefing, PainPoints, SellerGoals, NextAction, FavoriteOrFool, etc.)
    // so they all re-read manifest/activities in one go.
    window.dispatchEvent(new CustomEvent('crm:lead-refresh', { detail: { leadId: id } }))
  }, [id])

  // Listen for disposition logged events from the telephony bar
  useEffect(() => {
    function onDisposition(e: Event) {
      const detail = (e as CustomEvent).detail as { leadId?: string }
      if (detail?.leadId === id) refreshAll()
    }
    window.addEventListener('crm:disposition-logged', onDisposition)
    return () => window.removeEventListener('crm:disposition-logged', onDisposition)
  }, [id, refreshAll])

  useEffect(() => {
    async function fetchLead() {
      if (loadedLeadIdRef.current !== id) setLoading(true)
      try {
        const res = await fetch(`/api/leads/${id}`, { cache: 'no-store' })
        if (!res.ok) {
          console.error('[lead-detail] Failed to fetch lead:', res.status)
          setLead(null)
          return
        }
        const data = await res.json() as Lead & { nextAppointment?: AppointmentState | null }
        setLead(data)
        setNextAppointment(data.nextAppointment ?? null)

        const manifest = readObject(data.manifest)
        const financials = readObject(manifest?.financials)
        const property = readObject(manifest?.property)
        const assessment = readObject(property?.assessment)
        const pipeline = readObject(manifest?.pipeline)
        const rawAppointment = readObject(pipeline?.appointment)
        const communications = readObject(manifest?.communications)

        setManifestRowId(data.manifestId ?? null)
        setManifestProperty(property as ManifestProperty | null)
        setZestimate(typeof financials?.zillow_zestimate === 'number' && financials.zillow_zestimate > 0
          ? financials.zillow_zestimate
          : null)
        const appraised = typeof assessment?.appraisedTotal === 'number' && assessment.appraisedTotal > 0
          ? assessment.appraisedTotal
          : typeof assessment?.totalValue === 'number' && assessment.totalValue > 0
            ? assessment.totalValue
            : null
        setAssessedValue(appraised)
        setRedfinEstimate(typeof financials?.redfin_estimate === 'number' && financials.redfin_estimate > 0
          ? financials.redfin_estimate
          : null)

        const scheduledAt = typeof rawAppointment?.scheduledAt === 'string'
          && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(rawAppointment.scheduledAt)
          ? rawAppointment.scheduledAt
          : null
        const parsedAt = scheduledAt ? new Date(scheduledAt) : null
        setManifestAppointment(rawAppointment && scheduledAt && parsedAt && Number.isFinite(parsedAt.getTime())
          ? {
              appointmentId: typeof rawAppointment.appointmentId === 'string' ? rawAppointment.appointmentId : null,
              type: typeof rawAppointment.type === 'string' ? rawAppointment.type : null,
              scheduledAt,
              status: typeof rawAppointment.status === 'string' ? rawAppointment.status : 'scheduled',
              assignedTo: typeof rawAppointment.assignedTo === 'string' ? rawAppointment.assignedTo : null,
              address: typeof rawAppointment.address === 'string' ? rawAppointment.address : null,
              notes: typeof rawAppointment.notes === 'string' ? rawAppointment.notes : null,
              source: typeof rawAppointment.source === 'string' ? rawAppointment.source : null,
            }
          : null)
        setManifestScore(typeof manifest?.qualificationScore === 'number' ? manifest.qualificationScore : null)
        const transcripts = communications?.transcripts
        setManifestTranscripts(Array.isArray(transcripts)
          ? transcripts.filter((item): item is { date: string; recordingUrl?: string } => {
              const row = readObject(item)
              return typeof row?.date === 'string'
                && (row.recordingUrl === undefined || typeof row.recordingUrl === 'string')
            })
          : [])
        loadedLeadIdRef.current = id
      } catch (err) {
        console.error('[lead-detail] Failed to fetch lead:', err)
        setLead(null)
        setNextAppointment(null)
        setManifestRowId(null)
        setManifestProperty(null)
        setZestimate(null)
        setAssessedValue(null)
        setRedfinEstimate(null)
        setManifestAppointment(null)
        setManifestScore(null)
        setManifestTranscripts([])
      } finally {
        setLoading(false)
      }
    }
    if (id) fetchLead()
  }, [id, refreshTick])

  // On-demand Zillow enrichment: if manifest loaded but has no zestimate yet,
  // fire the enrichment endpoint once and bump refreshTick when it returns.
  useEffect(() => {
    if (!lead || !manifestRowId) return
    if (zestimate != null) return
    if (zillowEnriching) return
    if (!lead.property_address) return

    const sessionKey = `crm_zillow_tried_${lead.id}`
    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) return

    setZillowEnriching(true)
    if (typeof sessionStorage !== 'undefined') sessionStorage.setItem(sessionKey, '1')
    fetch('/api/enrich-zillow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: lead.id }),
    })
      .then((res) => res.ok ? res.json() : null)
      .then((data) => {
        if (data?.zestimate) refreshAll()
      })
      .catch(() => { /* silent — enrichment is best-effort */ })
      .finally(() => setZillowEnriching(false))
  }, [lead, manifestRowId, refreshAll, zestimate, zillowEnriching])

  const refreshRedfinEstimate = useCallback(async () => {
    if (!lead || !manifestRowId || redfinEnriching || !lead.property_address) return

    setRedfinEnriching(true)
    setRedfinError(null)
    try {
      const response = await fetch('/api/enrich-redfin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: lead.id }),
      })
      const data = await response.json().catch(() => null)
      if (!response.ok || !data?.success || !data?.redfinEstimate) {
        setRedfinError('Redfin could not return an estimate right now. Try again later.')
        return
      }
      setRedfinEstimate(data.redfinEstimate)
      refreshAll()
    } catch {
      setRedfinError('Redfin could not return an estimate right now. Try again later.')
    } finally {
      setRedfinEnriching(false)
    }
  }, [lead, manifestRowId, redfinEnriching, refreshAll])

  useEffect(() => {
    async function fetchActivities() {
      const res = await fetch(`/api/leads/${id}/activities?limit=50`, { cache: 'no-store' })
      const data = res.ok ? await res.json() : { activities: [] }
      const rows = (data.activities as ActivityRow[]) || []
      setActivities(rows)
    }
    if (id) fetchActivities()
  }, [id, refreshTick])

  // Subscribe to new communications instead of polling the database every 15 seconds.
  // User actions still refresh immediately; Realtime covers calls, voicemail, SMS, and email
  // arriving from external systems while the workspace is open.
  useEffect(() => {
    if (!id) return
    const supabase = createClient()
    const channel = supabase
      .channel(`lead-activity:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'lead_activities', filter: `lead_id=eq.${id}` },
        refreshAll,
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [id, refreshAll])

  function handleNoteAdded(note: ActivityRow) {
    setActivities(prev => [note, ...prev])
    refreshAll()
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
        <Link href="/contacts" className="text-primary hover:underline text-sm">Back to Contacts</Link>
      </div>
    )
  }

  const formattedName = toProperCase(lead.full_name)
  function openLeadDialer() {
    const dialLead = lead
    if (!dialLead?.phone) return
    window.dispatchEvent(new CustomEvent('open-dialer', {
      detail: {
        phone: dialLead.phone,
        name: formattedName,
        leadId: dialLead.id,
        callerId: callerIdForAssignedAgent(dialLead.assigned_agent),
      },
    }))
  }

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

  // Communication filtering belongs to LeadWorkspace, where agents can switch
  // between calls, texts, emails, notes, and voicemail without hiding timeline data here.
  const filteredActivities = activities

  // Merge disposition-only call rows (description "Call: <dispo>") into their
  // parent telephony call row (the "Outbound/Inbound call ..." entry) so the
  // disposition badge lands on the row with caller name + duration.
  const mergedActivities = (() => {
    const asc = [...filteredActivities].sort((a, b) =>
      a.created_at.localeCompare(b.created_at),
    )
    const dropIds = new Set<string>()
    const dispoByCallId = new Map<string, { disposition: string; notes?: string }>()
    for (let i = 0; i < asc.length; i++) {
      const row = asc[i]
      if (row.activity_type !== 'call') continue
      const m = (row.metadata || {}) as Record<string, unknown>
      const isDispoOnly = !!m.disposition && !m.direction && !m.status
      if (!isDispoOnly) continue
      const phone = (m.phone as string | undefined)?.trim() || ''
      for (let j = i - 1; j >= 0; j--) {
        const prev = asc[j]
        if (prev.activity_type !== 'call') continue
        const pm = (prev.metadata || {}) as Record<string, unknown>
        if (!pm.direction) continue
        if (dispoByCallId.has(prev.id)) continue
        const prevPhone = ((pm.to as string | undefined) || (pm.from as string | undefined) || '').trim()
        if (phone && prevPhone && phone !== prevPhone) continue
        dispoByCallId.set(prev.id, {
          disposition: m.disposition as string,
          notes: m.notes as string | undefined,
        })
        dropIds.add(row.id)
        break
      }
    }
    return filteredActivities
      .filter((a) => !dropIds.has(a.id))
      .map((a) => {
        const extra = dispoByCallId.get(a.id)
        if (!extra) return a
        const existingMeta = (a.metadata || {}) as Record<string, unknown>
        return {
          ...a,
          metadata: {
            ...existingMeta,
            disposition: extra.disposition,
            notes: (existingMeta.notes as string | undefined) || extra.notes,
          },
        }
      })
  })()

  // Resolve recordings once and pass the same canonical activity objects to
  // both the overview conversation and the full activity feed. Previously the
  // feed received this normalized metadata while LeadWorkspace received raw
  // rows, which made live recordings appear to be missing on the overview.
  const workspaceActivities = normalizeLeadRecordingActivities(mergedActivities, manifestTranscripts)

  // Build feed activities - include notes, appointments, call recordings
  const feedActivities = workspaceActivities
    .slice(0, 30)
    .map((a) => {
      let link: string | undefined
      let linkLabel: string | undefined
      let recordingUrl: string | undefined
      let recordingDuration: number | undefined

      if (a.activity_type === 'status_change' && a.metadata) {
        const newStation = a.metadata.new_station as string | undefined
        const opportunityStages = ['qualifying', 'appt_set', 'negotiations']
        if (newStation && opportunityStages.includes(newStation)) {
          link = '/contacts?list=qualified'
          linkLabel = 'View opportunities'
        }
      }

      // workspaceActivities already canonicalizes legacy metadata and manifest
      // transcript fallbacks into these two fields.
      if ((a.activity_type === 'call' || a.activity_type === 'voicemail') && a.metadata) {
        recordingUrl = typeof a.metadata.recordingUrl === 'string' ? a.metadata.recordingUrl : undefined
        const durationValue = Number(a.metadata.recordingDuration || a.metadata.duration)
        if (Number.isFinite(durationValue) && durationValue > 0) {
          recordingDuration = durationValue
        }
      }

      const typeMap: Record<string, string> = {
        sms: 'SMS',
        call: 'Phone call',
        voicemail: 'Voicemail',
        email: 'Email',
        note: 'Agent Note',
        agent_note: 'Agent Note',
        task: 'Task',
        appointment: 'Appointment',
        appointment_outcome: 'Appointment Outcome',
        offer: 'Offer',
        contract_sent: 'Contract Sent',
        letter_tracking: 'Mail',
        status_change: 'Status update',
      }

      // Determine direction for calls/SMS
      let title = typeMap[a.activity_type] || a.activity_type.replace(/_/g, ' ')
      const direction = a.metadata?.direction as string | undefined
      const status = a.metadata?.status as string | undefined

      if (a.activity_type === 'call') {
        // Extract caller name from description (e.g., "Inbound call from Robert Kilgore — no-answer")
        const descParts = a.description?.split('—') || []
        const callerPart = descParts[0]?.trim() || ''
        const statusPart = descParts[1]?.trim() || status || ''

        if (a.metadata?.source === 'twilio_recording_callback' || a.metadata?.source === 'recording_activity_backfill') {
          title = 'Call recording'
        } else if (direction === 'inbound') {
          // Extract just the name (remove "Inbound call from" prefix if present)
          const nameMatch = callerPart.match(/(?:Inbound call from|from)\s+(.+)/i)
          const callerName = nameMatch?.[1] || callerPart || 'Unknown'
          title = `Inbound call from ${callerName}`
        } else if (direction === 'outbound') {
          title = 'Outbound call'
        } else {
          title = 'Phone call'
        }

        // Add status as badge instead of in title
        if (statusPart) {
          // Status will be shown in the UI, not in title
        }
      } else if (a.activity_type === 'sms') {
        if (direction === 'inbound') {
          title = 'Received text message'
        } else if (direction === 'outbound') {
          title = 'Sent text message'
        }
      } else if (a.activity_type === 'voicemail') {
        title = 'New voicemail'
      }

      // For calls, extract status info and duration from description
      let statusBadge: string | undefined
      let cleanContent: string | undefined
      let dispositionLabel: string | undefined
      let dispositionTone: 'positive' | 'neutral' | 'negative' | undefined

      if (a.activity_type === 'call' && a.description) {
        const metaDuration = typeof a.metadata?.duration === 'number'
          ? (a.metadata.duration as number)
          : undefined
        const metaStatus = a.metadata?.status as string | undefined

        const fmtMMSS = (sec: number) => {
          const m = Math.floor(sec / 60)
          const s = sec % 60
          return `${m}:${String(s).padStart(2, '0')}`
        }

        if (metaDuration && metaDuration > 0) {
          statusBadge = fmtMMSS(metaDuration)
        } else if (metaStatus === 'no-answer') {
          statusBadge = 'No answer'
        } else if (metaStatus === 'busy') {
          statusBadge = 'Busy'
        } else {
          // Fallback: parse from description tail ("— 1526s" or "— completed (45s)")
          const tail = a.description.split('—')[1]?.trim()
          if (tail) {
            const m1 = tail.match(/^(\d+)s$/)
            const m2 = tail.match(/([a-z-]+)\s*\((\d+)s\)/i)
            if (m1) {
              statusBadge = fmtMMSS(parseInt(m1[1], 10))
            } else if (m2) {
              const [, callStatus, duration] = m2
              const n = parseInt(duration, 10)
              if (callStatus === 'completed' && n > 0) statusBadge = fmtMMSS(n)
              else if (callStatus === 'no-answer') statusBadge = 'No answer'
              else if (callStatus === 'busy') statusBadge = 'Busy'
              else statusBadge = callStatus
            } else {
              statusBadge = tail
            }
          }
        }

        // Show disposition notes from metadata (call dispositions save notes there)
        const callNotes = (a.metadata?.notes as string | undefined) || undefined
        cleanContent = callNotes

        // Surface disposition result as a badge
        const dispo = a.metadata?.disposition as string | undefined
        if (dispo) {
          const DISPOSITION_LABELS: Record<string, string> = {
            // current set surfaced by the disposition modal
            answered: 'Answered',
            no_answer: 'No Answer',
            left_vm: 'Left Voicemail',
            left_voicemail: 'Left Voicemail',
            bad_number: 'Bad Number',
            busy: 'Busy',
            dnc: 'Do Not Call',
            // legacy values still present in historical rows
            spoke_with_owner: 'Answered',
            callback_requested: 'Callback Requested',
            not_interested: 'Not Interested',
            wrong_number: 'Bad Number',
            disconnected: 'Disconnected',
            deal_potential: 'Deal Potential',
            appointment_set: 'Appointment Set',
            offer_made: 'Offer Made',
            dead: 'Dead',
          }
          const POSITIVE = new Set(['answered', 'spoke_with_owner', 'callback_requested', 'deal_potential', 'appointment_set', 'offer_made'])
          const NEGATIVE = new Set(['bad_number', 'wrong_number', 'disconnected', 'dnc', 'not_interested', 'dead'])
          dispositionLabel = DISPOSITION_LABELS[dispo] || dispo.replace(/_/g, ' ')
          dispositionTone = POSITIVE.has(dispo) ? 'positive' : NEGATIVE.has(dispo) ? 'negative' : 'neutral'
        }
      } else {
        cleanContent = a.description || undefined
      }

      return {
        id: a.id,
        type: activityTypeToFeedType(a.activity_type),
        title,
        content: cleanContent,
        timestamp: a.created_at, // Pass raw ISO timestamp, let ActivityFeed format it
        statusBadge,
        dispositionLabel,
        dispositionTone,
        direction: (direction === 'inbound' ? 'inbound' : direction === 'outbound' ? 'outbound' : undefined) as 'inbound' | 'outbound' | undefined,
        link,
        linkLabel,
        recordingUrl,
        recordingDuration,
        rawType: a.activity_type,
        agentName: a.agent || undefined,
        metadata: a.metadata || undefined,
      }
    })

  const workspacePropertyDetails = (() => {
    const mp = manifestProperty || {}
    const pick = <T,>(a: T | null | undefined, b: T | null | undefined): T | null =>
      (a !== null && a !== undefined ? a : (b !== null && b !== undefined ? b : null))
    const taxCollector = mp.taxCollector || {}
    const explicitDelinquentYear =
      taxCollector.firstDelinquentYear ??
      taxCollector.firstYearDelinquent ??
      taxCollector.delinquentSince ??
      taxCollector.oldestDelinquentYear
    let firstDelinquentYear: number | null = null
    if (typeof explicitDelinquentYear === 'number' && explicitDelinquentYear > 1900) {
      firstDelinquentYear = explicitDelinquentYear
    } else if (typeof explicitDelinquentYear === 'string') {
      const parsed = parseInt(explicitDelinquentYear.slice(0, 4), 10)
      if (parsed > 1900) firstDelinquentYear = parsed
    } else if (typeof taxCollector.yearsDelinquent === 'number' && taxCollector.yearsDelinquent > 0) {
      firstDelinquentYear = new Date().getFullYear() - taxCollector.yearsDelinquent
    }

    return {
      beds: pick(lead.beds, mp.beds),
      baths_full: pick(lead.baths_full, mp.baths_full ?? mp.bathsFull),
      baths_half: pick(lead.baths_half, mp.baths_half ?? mp.bathsHalf),
      sqft: pick(lead.sqft, mp.sqft ?? mp.squareFeet),
      lot_size: pick(lead.lot_size, mp.lot_size ?? mp.lotSize),
      year_built: pick(lead.year_built, mp.year_built ?? mp.yearBuilt),
      basement_type: pick(lead.basement_type, mp.basement_type ?? mp.basement),
      stories: pick(lead.stories, mp.stories),
      garage_spaces: pick(lead.garage_spaces, mp.garage_spaces ?? mp.garage),
      roof_type: pick(lead.roof_type, mp.roof_type ?? mp.roof),
      heating: pick(lead.heating, mp.heating),
      cooling: pick(lead.cooling, mp.cooling),
      property_type: pick(lead.property_type, mp.property_type ?? mp.propertyType),
      zoning: pick(lead.zoning, mp.zoning),
      hoa_amount: pick(lead.hoa_amount, mp.hoa_amount),
      tax_assessment: pick(lead.tax_assessment, mp.assessment?.totalValue ?? mp.tax_assessment),
      tax_owed: taxCollector.totalOwed ?? taxCollector.delinquentAmount ?? null,
      first_delinquent_year: firstDelinquentYear,
      last_sale_date: pick(lead.last_sale_date, mp.last_sale_date ?? mp.lastSaleDate),
      last_sale_price: pick(lead.last_sale_price, mp.last_sale_price ?? mp.lastSalePrice),
      data_source: pick(lead.data_source, mp.assessment?.source ?? mp.data_source),
      data_enriched_at: pick(lead.data_enriched_at, mp.assessment?.fetchedAt ?? mp.data_enriched_at),
    }
  })()

  return (
    <>
      <LeadWorkspace
        lead={lead}
        activities={workspaceActivities}
        appointment={activeAppointment ? {
          scheduledAt: activeAppointment.scheduledAt,
          address: activeAppointment.address,
          type: activeAppointment.type,
        } : null}
        score={manifestScore ?? lead.motivation_score}
        assessedValue={assessedValue ?? lead.tax_assessment}
        onCall={openLeadDialer}
        onEdit={() => setEditPanelOpen(true)}
        onText={() => {
          setComposeTab('sms')
          setSmsModalOpen(true)
        }}
        onEmail={() => {
          setComposeTab('email')
          setSmsModalOpen(true)
        }}
        onAppointment={() => setAppointmentModalOpen(true)}
        onAppointmentOutcome={() => setOutcomeModalOpen(true)}
        onTask={() => setShowNewTask(true)}
        onContract={() => setContractModalOpen(true)}
        onOpenProperty={() => setDetailsExpanded(true)}
        onRefresh={refreshAll}
        onStageChange={(station, outcome) => setLead((current) => current ? {
          ...current,
          station,
          ...(station === 'dead'
            ? { classification: 'dead', priority: 'cold', dead_reason: outcome?.deadReason ?? current.dead_reason }
            : current.station === 'dead'
              ? { classification: 'lead', priority: current.priority === 'cold' ? 'warm' : current.priority, dead_reason: null }
              : {}),
        } : current)}
        onLeadStatusChange={(update) => setLead((current) => current ? {
          ...current,
          classification: update.classification,
          station: update.station,
          priority: update.priority,
          dead_reason: update.dead_reason,
        } : current)}
        sectionPanels={{
          property: (
            <div className="mx-auto grid w-full max-w-[1380px] items-start gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(420px,0.85fr)]">
              <div className="min-w-0">
                <PropertyHero
                  property={property}
                  zestimate={zestimate}
                  redfinEstimate={redfinEstimate}
                  assessedValue={assessedValue ?? lead.tax_assessment ?? null}
                  taxOwed={
                    manifestProperty?.taxCollector?.totalOwed ??
                    manifestProperty?.taxCollector?.delinquentAmount ??
                    null
                  }
                  estimateLoading={zillowEnriching && zestimate == null}
                  redfinLoading={redfinEnriching}
                  redfinError={redfinError}
                  onRefreshRedfin={refreshRedfinEstimate}
                  onOpenDetails={() => setDetailsExpanded(true)}
                />
              </div>
              <div className="min-w-0">
                <PropertyDetailsCard
                  details={workspacePropertyDetails}
                  onEdit={() => setEditPanelOpen(true)}
                />
              </div>
            </div>
          ),
          documents: (
            <DocumentManager
              entityType="lead"
              entityId={id}
              side="acquisitions"
              defaultDocType="purchase_contract"
              title="Lead Documents"
            />
          ),
          ai: (
            <div className="grid gap-5 lg:grid-cols-2">
              <LeadAiChangeReview leadId={lead.id} onApplied={refreshAll} />
              <AriBriefing
                leadId={lead.id}
                manifestId={manifestRowId ?? undefined}
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
              <FavoriteOrFool
                leadId={lead.id}
                manifestId={manifestRowId ?? undefined}
                motivationScore={lead.motivation_score}
                arv={lead.arv}
                offerAmount={lead.offer_amount}
                repairEstimate={lead.repair_estimate}
                station={lead.station}
                notes={lead.notes}
                sellerSituation={lead.seller_situation}
                classification={lead.classification}
                priority={lead.priority}
                isFavorite={lead.is_favorite}
                opportunityScore={lead.opportunity_score}
                activities={activities}
              />
              <DiscoveryQuestions
                leadId={lead.id}
                notes={lead.notes}
                sellerSituation={lead.seller_situation}
                offerAmount={lead.offer_amount}
                sqft={lead.sqft}
                yearBuilt={lead.year_built}
                activities={activities}
              />
            </div>
          ),
          marketing: (
            <div className="grid gap-5 lg:grid-cols-2">
              <AdsSignalReceipt leadId={lead.id} variant="sidebar" />
              <MailTracker leadId={lead.id} leadName={lead.full_name ?? undefined} onLogged={refreshAll} />
              <div className="lg:col-span-2">
                <EmailThread leadId={id} />
              </div>
            </div>
          ),
          activity: (
            <ActivityFeed
              activities={feedActivities}
              leadPhone={lead.phone ?? undefined}
              leadEmail={lead.email ?? undefined}
              leadId={id}
              prominent
              onCompose={(type) => {
                if (type === 'call') {
                  openLeadDialer()
                } else {
                  setComposeTab(type)
                  setSmsModalOpen(true)
                }
              }}
              onEditNote={(noteId, currentContent) => {
                setEditNoteId(noteId)
                setEditNoteContent(currentContent)
              }}
              onEditTask={(taskId, currentTitle, metadata) => {
                setEditTaskId(taskId)
                setEditTaskTitle(currentTitle)
                setEditTaskMetadata(metadata)
              }}
            />
          ),
        }}
      />


      {/* Modals */}
      {editPanelOpen && (
        <EditLeadPanel
          lead={lead}
          onClose={() => setEditPanelOpen(false)}
          onSaved={(updated) => {
            setLead((prev) => prev ? { ...prev, ...updated } : prev)
            refreshAll()
          }}
        />
      )}
      {contractModalOpen && (
        <ContractModal
          lead={lead}
          onClose={() => setContractModalOpen(false)}
          onSuccess={() => { refreshAll() }}
        />
      )}
      {appointmentModalOpen && (
        <AppointmentModal
          lead={lead}
          initialAppointment={activeAppointment}
          onClose={() => setAppointmentModalOpen(false)}
          onSuccess={() => { refreshAll() }}
        />
      )}
      {showNewTask && (
        <NewTaskModal
          leadId={lead.id}
          leadName={toProperCase(lead.full_name || '') || lead.property_address || 'Unknown'}
          onClose={() => setShowNewTask(false)}
          onCreated={() => { setShowNewTask(false); refreshAll() }}
        />
      )}
      {outcomeModalOpen && activeAppointment && (
        <AppointmentOutcomeModal
          lead={lead}
          appointment={activeAppointment}
          onClose={() => setOutcomeModalOpen(false)}
          onSuccess={() => { refreshAll() }}
        />
      )}
      {smsModalOpen && (lead.phone || lead.email) && (
        <SmsComposeModal
          lead={lead}
          onClose={() => setSmsModalOpen(false)}
          onSent={() => { refreshAll() }}
          initialTab={composeTab}
        />
      )}
      {editNoteId && (
        <EditNoteModal
          noteId={editNoteId}
          initialContent={editNoteContent}
          onClose={() => {
            setEditNoteId(null)
            setEditNoteContent('')
          }}
          onSaved={(noteId, newContent) => {
            // Update the activity in the local state
            setActivities((prev) =>
              prev.map((a) =>
                a.id === noteId ? { ...a, description: newContent } : a
              )
            )
            refreshAll()
          }}
          onDeleted={(noteId) => {
            // Remove from local state
            setActivities((prev) => prev.filter((a) => a.id !== noteId))
            refreshAll()
          }}
        />
      )}
      {editTaskId && (
        <EditTaskModal
          taskId={editTaskId}
          initialTitle={editTaskTitle}
          initialMetadata={editTaskMetadata as Record<string, string>}
          onClose={() => {
            setEditTaskId(null)
            setEditTaskTitle('')
            setEditTaskMetadata({})
          }}
          onSaved={(taskId, newTitle, newMetadata) => {
            // Update the activity in the local state
            setActivities((prev) =>
              prev.map((a) =>
                a.id === taskId ? { ...a, description: newTitle, metadata: newMetadata } : a
              )
            )
            refreshAll()
          }}
          onDeleted={(taskId) => {
            // Remove from local state
            setActivities((prev) => prev.filter((a) => a.id !== taskId))
            refreshAll()
          }}
        />
      )}
      {notesModalOpen && (
        <>
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={() => setNotesModalOpen(false)} />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              ref={notesDialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-note-title"
              tabIndex={-1}
              className="rounded-2xl shadow-2xl w-full max-w-lg border"
              style={{ background: 'var(--ck-surface)', borderColor: 'var(--ck-border)' }}
            >
              <div
                className="flex items-center justify-between px-6 py-4"
                style={{ borderBottom: '1px solid var(--ck-border)' }}
              >
                <div className="flex items-center gap-2">
                  <Icon name="edit_note" className="!text-[color:var(--ck-accent)]" />
                  <h2 id="add-note-title" className="text-lg font-bold" style={{ color: 'var(--ck-text)' }}>Add Note</h2>
                </div>
                <button
                  type="button"
                  onClick={() => setNotesModalOpen(false)}
                  aria-label="Close add note dialog"
                  className="transition-colors"
                  style={{ color: 'var(--ck-text-muted)' }}
                >
                  <Icon name="close" />
                </button>
              </div>
              <div className="p-6">
                <AddNote
                  leadId={lead.id}
                  alwaysExpanded
                  hideHeading
                  hideCancel
                  onNoteAdded={(note) => {
                    handleNoteAdded(note)
                    setNotesModalOpen(false)
                  }}
                />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Property details modal — opens on double-click of PropertyHero stats row */}
      <CockpitModal
        open={detailsExpanded}
        onClose={() => setDetailsExpanded(false)}
        title="Property Details"
        icon="home_work"
        size="lg"
      >
        {(() => {
          const mp = manifestProperty || {}
          const pick = <T,>(a: T | null | undefined, b: T | null | undefined): T | null =>
            (a !== null && a !== undefined ? a : (b !== null && b !== undefined ? b : null))
          return (
            <PropertyDetailsCard
              details={{
                beds: pick(lead.beds, mp.beds),
                baths_full: pick(lead.baths_full, mp.baths_full ?? mp.bathsFull),
                baths_half: pick(lead.baths_half, mp.baths_half ?? mp.bathsHalf),
                sqft: pick(lead.sqft, mp.sqft ?? mp.squareFeet),
                lot_size: pick(lead.lot_size, mp.lot_size ?? mp.lotSize),
                year_built: pick(lead.year_built, mp.year_built ?? mp.yearBuilt),
                basement_type: pick(lead.basement_type, mp.basement_type ?? mp.basement),
                stories: pick(lead.stories, mp.stories),
                garage_spaces: pick(lead.garage_spaces, mp.garage_spaces ?? mp.garage),
                roof_type: pick(lead.roof_type, mp.roof_type ?? mp.roof),
                heating: pick(lead.heating, mp.heating),
                cooling: pick(lead.cooling, mp.cooling),
                property_type: pick(lead.property_type, mp.property_type ?? mp.propertyType),
                zoning: pick(lead.zoning, mp.zoning),
                hoa_amount: pick(lead.hoa_amount, mp.hoa_amount),
                tax_assessment: pick(lead.tax_assessment, mp.assessment?.totalValue ?? mp.tax_assessment),
                tax_owed: mp.taxCollector?.totalOwed ?? mp.taxCollector?.delinquentAmount ?? null,
                first_delinquent_year: (() => {
                  const tc = mp.taxCollector || {}
                  // Prefer an explicit year field
                  const explicit =
                    tc.firstDelinquentYear ??
                    tc.firstYearDelinquent ??
                    tc.delinquentSince ??
                    tc.oldestDelinquentYear
                  if (typeof explicit === 'number' && explicit > 1900) return explicit
                  if (typeof explicit === 'string') {
                    const parsed = parseInt(explicit.slice(0, 4), 10)
                    if (parsed > 1900) return parsed
                  }
                  // Fall back to computing from yearsDelinquent
                  const yrs = tc.yearsDelinquent
                  if (typeof yrs === 'number' && yrs > 0) {
                    return new Date().getFullYear() - yrs
                  }
                  return null
                })(),
                last_sale_date: pick(lead.last_sale_date, mp.last_sale_date ?? mp.lastSaleDate),
                last_sale_price: pick(lead.last_sale_price, mp.last_sale_price ?? mp.lastSalePrice),
                data_source: pick(lead.data_source, mp.assessment?.source ?? mp.data_source),
                data_enriched_at: pick(lead.data_enriched_at, mp.assessment?.fetchedAt ?? mp.data_enriched_at),
              }}
              address={lead.property_address || undefined}
              city={lead.city || undefined}
              state={lead.state || undefined}
              zip={lead.zip || undefined}
              leadId={id}
              onEdit={() => {
                setDetailsExpanded(false)
                setEditPanelOpen(true)
              }}
            />
          )
        })()}
      </CockpitModal>
    </>
  )
}
