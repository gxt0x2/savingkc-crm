'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { CallReviewSubmitButton } from '@/components/call-review/call-review-submit-button'
import { EntityIdentityStatus } from '@/components/leads/entity-identity-status'
import { StreetViewPanel } from '@/components/leads/google-map-panel'
import { LeadOpportunityPanel, LEAD_WORKSPACE_STAGES } from '@/components/leads/lead-opportunity-panel'
import { openLeadNextAction } from '@/components/leads/governed-next-action'
import { RecordOfferModal } from '@/components/leads/record-offer-modal'
import { StageSelector } from '@/components/leads/stage-selector'
import { LeadStatusControl, type LeadStatusUpdate } from '@/components/leads/lead-status-control'
import { formatPhone, toProperCase } from '@/lib/format'
import {
  filterLeadConversation,
  leadActivityText,
  leadConversationCounts,
  normalizeLeadConversation,
  type LeadCommunicationFilter,
} from '@/lib/lead-conversation'
import { playableRecordingUrl } from '@/lib/marketing/call-recordings'
import { cn } from '@/lib/utils'
import type { CrmEntityContext } from '@/lib/server/crm-entity-foundation'

export interface LeadWorkspaceLead {
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
  assigned_agent: string | null
  beds: number | null
  baths_full: number | null
  baths_half: number | null
  sqft: number | null
  year_built: number | null
  motivation_score: number | null
  arv: number | null
  offer_amount: number | null
  classification?: 'lead' | 'opportunity' | 'dead' | null
  dead_reason?: string | null
  entityContext?: CrmEntityContext | null
}

export interface LeadWorkspaceActivity {
  id: string
  activity_type: string
  description: string | null
  agent: string | null
  metadata: Record<string, unknown> | null
  created_at: string
}

interface LeadWorkspaceAppointment {
  scheduledAt: string
  address?: string | null
  type?: string | null
}

interface LeadWorkspaceProps {
  lead: LeadWorkspaceLead
  activities: LeadWorkspaceActivity[]
  appointment: LeadWorkspaceAppointment | null
  score: number | null
  assessedValue: number | null
  onCall: () => void
  onEdit: () => void
  onText: () => void
  onEmail: () => void
  onAppointment: () => void
  onAppointmentOutcome: () => void
  onTask: () => void
  onContract: () => void
  onOpenProperty: () => void
  onRefresh: () => void
  onStageChange: (station: string, outcome?: { deadReason: string | null }) => void
  onLeadStatusChange: (update: LeadStatusUpdate) => void
  sectionPanels?: Partial<Record<LeadWorkspaceSection, React.ReactNode>>
}

export type LeadWorkspaceSection = 'overview' | 'property' | 'documents' | 'ai' | 'marketing' | 'activity'

const WORKSPACE_SECTIONS: { key: LeadWorkspaceSection; icon: string; label: string; activeTone: string; iconTone: string }[] = [
  { key: 'overview', icon: 'grid_view', label: 'Overview', activeTone: 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]', iconTone: 'text-[var(--crm-brand)]' },
  { key: 'property', icon: 'home_work', label: 'Property details', activeTone: 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]', iconTone: 'text-[var(--crm-brand)]' },
  { key: 'documents', icon: 'description', label: 'Documents', activeTone: 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]', iconTone: 'text-[var(--crm-brand)]' },
  { key: 'ai', icon: 'auto_awesome', label: 'AI insights', activeTone: 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]', iconTone: 'text-[var(--crm-brand)]' },
  { key: 'marketing', icon: 'campaign', label: 'Marketing', activeTone: 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]', iconTone: 'text-[var(--crm-brand)]' },
  { key: 'activity', icon: 'history', label: 'Activity log', activeTone: 'border-[var(--crm-brand)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]', iconTone: 'text-[var(--crm-brand)]' },
]

const ACTIVITY_META: Record<string, { icon: string; label: string; tone: string }> = {
  sms: { icon: 'chat_bubble', label: 'SMS', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  call: { icon: 'call', label: 'Call', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  voicemail: { icon: 'voicemail', label: 'Voicemail', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
  email: { icon: 'mail', label: 'Email', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  note: { icon: 'description', label: 'Internal note', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
  agent_note: { icon: 'description', label: 'Internal note', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
  task: { icon: 'check_circle', label: 'Task', tone: 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]' },
  appointment: { icon: 'calendar_month', label: 'Appointment', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
  offer: { icon: 'request_quote', label: 'Offer', tone: 'bg-[var(--crm-success-soft)] text-[var(--crm-success)]' },
}

const COMMUNICATION_FILTERS: { key: LeadCommunicationFilter; label: string; icon: string }[] = [
  { key: 'all', label: 'All', icon: 'forum' },
  { key: 'call', label: 'Calls', icon: 'call' },
  { key: 'sms', label: 'Texts', icon: 'chat_bubble' },
  { key: 'email', label: 'Emails', icon: 'mail' },
  { key: 'note', label: 'Notes', icon: 'description' },
  { key: 'voicemail', label: 'Voicemail', icon: 'voicemail' },
]

function formatMoney(value: number | null) {
  return value == null ? '—' : `$${Math.round(value).toLocaleString()}`
}

function formatActivityDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const today = new Date()
  const day = date.toDateString() === today.toDateString()
    ? 'Today'
    : date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return `${day} · ${date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`
}

function directionFor(activity: LeadWorkspaceActivity) {
  const direction = String(activity.metadata?.direction || '').toLowerCase()
  if (direction === 'inbound') return 'Inbound'
  if (direction === 'outbound') return 'Outbound'
  return ''
}

export function LeadWorkspace({
  lead,
  activities,
  appointment,
  score,
  assessedValue,
  onCall,
  onEdit,
  onText,
  onEmail,
  onAppointment,
  onAppointmentOutcome,
  onTask,
  onContract,
  onOpenProperty,
  onRefresh,
  onStageChange,
  onLeadStatusChange,
  sectionPanels,
}: LeadWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<LeadWorkspaceSection>('overview')
  const [composeMode, setComposeMode] = useState<'sms' | 'email' | 'note'>('sms')
  const [communicationFilter, setCommunicationFilter] = useState<LeadCommunicationFilter>('all')
  const [message, setMessage] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const [contextPanelOpen, setContextPanelOpen] = useState(false)
  const [operationsPanelOpen, setOperationsPanelOpen] = useState(false)
  const [streetViewOpen, setStreetViewOpen] = useState(false)
  const [offerModalOpen, setOfferModalOpen] = useState(false)
  const [renderedAt] = useState(() => Date.now())
  const sectionHeadingRef = useRef<HTMLDivElement>(null)
  const name = toProperCase(lead.full_name) || 'Unknown contact'
  const firstName = name.split(/\s+/)[0]
  const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  const owner = toProperCase(lead.assigned_agent) || 'Unassigned'
  const address = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x500&location=${encodeURIComponent(address)}&fov=90&pitch=4&key=${process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''}`
  const stageIndex = Math.max(0, LEAD_WORKSPACE_STAGES.findIndex((stage) => stage.keys.includes((lead.station || 'new').toLowerCase())))
  const normalizedActivities = useMemo(() => normalizeLeadConversation(activities), [activities])
  const communicationCounts = useMemo(() => leadConversationCounts(normalizedActivities), [normalizedActivities])
  const visibleActivities = useMemo(
    () => filterLeadConversation(normalizedActivities, communicationFilter),
    [communicationFilter, normalizedActivities],
  )
  const latestOfferActivity = useMemo(() => [...activities]
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .find((activity) => activity.activity_type === 'offer' || typeof activity.metadata?.offer_method === 'string'),
  [activities])
  const latestOfferMethod = latestOfferActivity?.metadata?.offer_method === 'written'
    ? 'Written'
    : latestOfferActivity?.metadata?.offer_method === 'verbal'
      ? 'Verbal'
      : null
  const nextTask = useMemo(() => openLeadNextAction(activities), [activities])
  const appointmentIsPast = Boolean(appointment && new Date(appointment.scheduledAt).getTime() < renderedAt)
  const nextAction = appointmentIsPast
    ? 'Record appointment outcome'
    : appointment
      ? `Appointment ${new Date(appointment.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : nextTask?.title || 'Define the next action'

  useEffect(() => {
    if (!contextPanelOpen && !operationsPanelOpen && !streetViewOpen) return
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setContextPanelOpen(false)
        setOperationsPanelOpen(false)
        setStreetViewOpen(false)
      }
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [contextPanelOpen, operationsPanelOpen, streetViewOpen])

  function openContextPanel() {
    setOperationsPanelOpen(false)
    setContextPanelOpen(true)
  }

  function openOperationsPanel() {
    setContextPanelOpen(false)
    setOperationsPanelOpen(true)
  }

  function closePanels() {
    setContextPanelOpen(false)
    setOperationsPanelOpen(false)
  }

  function runNextAction() {
    closePanels()
    if (appointmentIsPast) {
      onAppointmentOutcome()
    } else if (appointment) {
      onAppointment()
    } else {
      onTask()
    }
  }

  function openPropertyDetails() {
    closePanels()
    onOpenProperty()
  }

  function openStreetView() {
    closePanels()
    setStreetViewOpen(true)
  }

  function openOffer() {
    closePanels()
    setOfferModalOpen(true)
  }

  function selectSection(section: LeadWorkspaceSection) {
    setActiveSection(section)
    window.requestAnimationFrame(() => {
      sectionHeadingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }

  async function sendMessage() {
    if (!message.trim()) return
    if (composeMode === 'sms' && !lead.phone) {
      setSendError('This contact does not have a phone number.')
      return
    }
    if (composeMode === 'email' && !lead.email) {
      setSendError('This contact does not have an email address.')
      return
    }

    setSending(true)
    setSendError(null)
    try {
      const isNote = composeMode === 'note'
      const response = await fetch(
        isNote ? `/api/leads/${lead.id}/activities` : '/api/conversations/send',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(isNote ? {
            description: message.trim(),
            agent: owner === 'Unassigned' ? 'Ernest' : owner,
          } : composeMode === 'sms' ? {
            leadId: lead.id,
            phone: lead.phone,
            body: message.trim(),
            mode: 'sms',
            agent: owner === 'Unassigned' ? 'Ernest' : owner,
          } : {
            leadId: lead.id,
            to: lead.email,
            subject: emailSubject.trim() || `Regarding ${lead.property_address || 'your property'}`,
            body: message.trim(),
            mode: 'email',
            agent: owner === 'Unassigned' ? 'Ernest' : owner,
          }),
        },
      )
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result.error || 'Message could not be sent')
      setMessage('')
      setEmailSubject('')
      onRefresh()
    } catch (error) {
      setSendError(error instanceof Error ? error.message : 'Message could not be sent')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto bg-[var(--crm-canvas)]">
      {streetViewOpen ? createPortal(
        <StreetViewModal address={address} onClose={() => setStreetViewOpen(false)} />,
        document.body,
      ) : null}
      {offerModalOpen ? (
        <RecordOfferModal
          leadId={lead.id}
          leadName={name}
          currentAmount={lead.offer_amount}
          onClose={() => setOfferModalOpen(false)}
          onSaved={onRefresh}
        />
      ) : null}
      <div className="mx-auto max-w-[1640px] px-3 pb-5 pt-3 sm:px-4 sm:pb-8 sm:pt-4 xl:px-6">
        <header className="crm-panel-raised relative overflow-hidden rounded-2xl px-3 py-3 sm:rounded-xl sm:px-5 sm:py-3.5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="min-w-0">
              <div className="flex min-w-0 flex-wrap items-center gap-2.5">
                <Link href="/contacts" className="crm-icon-button flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" aria-label="Back to contacts">
                  <Icon name="arrow_back" />
                </Link>
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--crm-brand)] text-sm font-bold text-white ring-4 ring-[var(--crm-brand-soft)]">
                  {initials || 'SK'}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2 sm:flex-wrap">
                    <h1 className="min-w-0 flex-1 truncate text-lg font-bold tracking-[-0.03em] text-[var(--crm-ink)] sm:flex-none sm:text-2xl">{name}</h1>
                    <span className="hidden sm:inline-flex"><LeadStatusControl
                      leadId={lead.id}
                      classification={lead.classification}
                      station={lead.station}
                      priority={lead.priority}
                      deadReason={lead.dead_reason}
                      agent={lead.assigned_agent}
                      onChanged={onLeadStatusChange}
                    /></span>
                    <button type="button" onClick={openOperationsPanel} className="crm-icon-button grid h-10 w-10 shrink-0 place-items-center rounded-xl sm:hidden" aria-label="Open lead status and actions"><Icon name="tune" /></button>
                    {(lead.priority || '').toLowerCase() === 'hot' ? (
                      <span className="hidden items-center gap-1 rounded-md border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--crm-brand)] sm:inline-flex">
                        <Icon name="local_fire_department" className="text-[14px]" />Hot
                      </span>
                    ) : null}
                    <span className="hidden items-center gap-1 rounded-md border border-[var(--crm-success-border)] bg-[var(--crm-success-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--crm-success)] sm:inline-flex">
                      <Icon name="flag" className="text-[13px]" />
                      {LEAD_WORKSPACE_STAGES[stageIndex]?.label || toProperCase(lead.station) || 'New'}
                    </span>
                    <span className="hidden items-center gap-1.5 text-[11px] font-semibold text-[var(--crm-text-muted)] sm:inline-flex">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-[8px] font-bold text-[var(--crm-surface)]">{owner.slice(0, 2).toUpperCase()}</span>
                      {owner}
                    </span>
                    <EntityIdentityStatus context={lead.entityContext} />
                    <button type="button" onClick={onEdit} className="crm-icon-button hidden h-8 w-8 items-center justify-center rounded-lg sm:flex" aria-label="Edit contact">
                      <Icon name="edit" className="text-[17px]" />
                    </button>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-col gap-1 text-xs text-[var(--crm-text-muted)] sm:flex-row sm:flex-wrap sm:gap-x-4">
                    {address ? <button type="button" onClick={openContextPanel} className="flex min-w-0 max-w-[520px] items-center gap-1 text-left hover:text-[var(--crm-info)]"><Icon name="location_on" className="shrink-0 text-[16px]" /><span className="truncate">{address}</span></button> : null}
                    {lead.phone ? <button type="button" onClick={onCall} className="flex items-center gap-1 hover:text-[var(--crm-brand)]" aria-label={`Call ${name}`}><Icon name="call" className="text-[15px]" />{formatPhone(lead.phone)}</button> : null}
                    <button
                      type="button"
                      onClick={runNextAction}
                      className="flex min-w-0 items-center gap-1 font-bold text-[var(--crm-warning)] hover:brightness-90"
                    >
                      <Icon name="schedule" className="shrink-0 text-[15px]" />
                      <span className="max-w-[360px] truncate">{nextAction}</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-2 sm:flex sm:flex-wrap">
              <ActionButton icon="call" label="Call" onClick={onCall} disabled={!lead.phone} tone="teal" />
              <ActionButton icon="chat_bubble" label="Text" onClick={onText} disabled={!lead.phone} tone="blue" />
              <ActionButton icon="mail" label="Email" onClick={onEmail} disabled={!lead.email} tone="violet" />
              <button
                type="button"
                onClick={openOperationsPanel}
                aria-expanded={operationsPanelOpen}
                aria-controls="lead-operations-panel"
                aria-label="Open more lead actions"
                title="More lead actions"
                className="crm-secondary-button flex h-9 items-center justify-center gap-1.5 rounded-lg px-3 text-xs font-bold sm:text-sm"
              >
                <Icon name="tune" className="text-[18px]" />
                More
              </button>
            </div>
          </div>
        </header>

        <nav ref={sectionHeadingRef} className="crm-panel sticky top-0 z-20 mt-3 flex scroll-mt-4 overflow-x-auto rounded-xl [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:grid md:grid-cols-6" aria-label="Lead workspace sections">
          {WORKSPACE_SECTIONS.map(({ key, icon, label, activeTone, iconTone }) => (
            <button
              key={key}
              type="button"
              onClick={() => selectSection(key)}
              aria-current={activeSection === key ? 'page' : undefined}
              className={cn(
                'flex h-11 shrink-0 items-center justify-center gap-1.5 border-b-2 px-3 text-xs font-semibold transition-colors md:px-2 md:text-sm',
                activeSection === key
                  ? activeTone
                  : 'border-transparent text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-subtle)] hover:text-[var(--crm-ink)]',
              )}
            >
              <Icon name={icon} className={cn('text-[18px]', activeSection === key ? iconTone : 'text-[var(--crm-text-dim)]')} />
              {label}
            </button>
          ))}
        </nav>

        {contextPanelOpen || operationsPanelOpen ? (
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-black/35 backdrop-blur-[1px]"
            onClick={closePanels}
            aria-label="Close lead drawer"
          />
        ) : null}

        {contextPanelOpen ? (
          <aside
            id="lead-context-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lead-context-title"
            className="crm-panel-raised fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:bottom-3 sm:left-3 sm:right-auto sm:top-3 sm:max-h-none sm:w-[min(390px,calc(100vw-24px))] sm:rounded-xl"
          >
            <CardHeader
              id="lead-context-title"
              title="Contact & Property"
              icon="person"
              onMore={onEdit}
              onClose={closePanels}
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <SectionLabel>Contact</SectionLabel>
                <dl className="mt-3 space-y-3 text-sm">
                  <DataRow label="Phone" value={lead.phone ? formatPhone(lead.phone) : '—'} accent />
                  <DataRow label="Email" value={lead.email || '—'} accent />
                  <DataRow label="Owner" value={owner} />
                  <DataRow label="Preferred contact" value={lead.phone ? 'Text or call' : lead.email ? 'Email' : 'Not set'} />
                </dl>

                <div className="my-5 border-t border-[var(--crm-border)]" />
                <SectionLabel>Property snapshot</SectionLabel>
                <div className="mt-3 overflow-hidden rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)]">
                  <button
                    type="button"
                    onClick={openStreetView}
                    disabled={!address}
                    className="group relative block w-full overflow-hidden text-left disabled:cursor-not-allowed"
                    aria-label={address ? `Open Street View for ${address}` : 'Street View unavailable because the property address is missing'}
                  >
                    {!imageFailed && address ? (
                      // Google Street View is a signed dynamic image URL and is intentionally not routed through next/image.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={streetViewUrl}
                        alt={`Street view of ${address}`}
                        loading="lazy"
                        className="h-36 w-full object-cover transition-transform duration-300 group-hover:scale-[1.015]"
                        onError={() => setImageFailed(true)}
                      />
                    ) : (
                      <span className="flex h-36 items-center justify-center bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]">
                        <Icon name="home" className="text-[42px]" />
                      </span>
                    )}
                    {address ? <StreetViewHint /> : null}
                  </button>
                  <button
                    type="button"
                    onClick={openPropertyDetails}
                    className="flex w-full items-center gap-3 border-t border-[var(--crm-border)] px-4 py-3 text-left hover:bg-[var(--crm-surface-subtle)]"
                    aria-label="Open property details and county records"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block font-bold text-[var(--crm-ink)]">{lead.property_address || 'Property address missing'}</span>
                      <span className="mt-1 block text-xs text-[var(--crm-text-muted)]">{[lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}</span>
                    </span>
                    <span className="shrink-0 text-[10px] font-black uppercase tracking-[0.08em] text-[var(--crm-brand)]">County details</span>
                    <Icon name="chevron_right" className="shrink-0 text-[18px] text-[var(--crm-brand)]" />
                  </button>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <DataRow label="Beds" value={lead.beds?.toString() || '—'} compact />
                  <DataRow label="Baths" value={((lead.baths_full || 0) + (lead.baths_half ? 0.5 : 0)).toString() || '—'} compact />
                  <DataRow label="Sq Ft" value={lead.sqft?.toLocaleString() || '—'} compact />
                  <DataRow label="Year built" value={lead.year_built?.toString() || '—'} compact />
                </dl>
                <div className="my-5 border-t border-[var(--crm-border)]" />
                <DataRow label="Source" value={lead.source || 'Unknown'} />
                <div className="mt-5">
                  <SectionLabel>Tags</SectionLabel>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {[lead.priority === 'hot' ? 'Hot Lead' : null, lead.source, lead.station].filter(Boolean).map((tag) => (
                      <span key={tag} className="rounded-md border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-2.5 py-1 text-xs font-semibold capitalize text-[var(--crm-brand)]">
                        {String(tag).replace(/_/g, ' ')}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
          </aside>
        ) : null}

        {operationsPanelOpen ? (
          <aside
            id="lead-operations-panel"
            role="dialog"
            aria-modal="true"
            aria-labelledby="lead-operations-title"
            className="crm-panel-raised fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-3xl shadow-2xl sm:bottom-3 sm:left-auto sm:right-3 sm:top-3 sm:max-h-none sm:w-[min(410px,calc(100vw-24px))] sm:rounded-xl"
          >
            <CardHeader
              id="lead-operations-title"
              title="Lead controls"
              icon="tune"
              onClose={closePanels}
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
              <SectionLabel>Operating status</SectionLabel>
              <div className="mt-3 space-y-3">
                <SummaryItem label="Lead status" tone="teal">
                  <LeadStatusControl
                    leadId={lead.id}
                    classification={lead.classification}
                    station={lead.station}
                    priority={lead.priority}
                    deadReason={lead.dead_reason}
                    agent={lead.assigned_agent}
                    onChanged={onLeadStatusChange}
                    variant="panel"
                  />
                </SummaryItem>
                <SummaryItem label="Stage" tone="teal">
                  <StageSelector
                    leadId={lead.id}
                    station={lead.station}
                    size="md"
                    variant="workspace"
                    onAppointmentRequired={onAppointment}
                    onChange={(next, outcome) => onStageChange(next, outcome)}
                  />
                </SummaryItem>
                <SummaryItem label="Owner" tone="blue">
                  <span className="flex items-center gap-2 font-semibold text-[var(--crm-text)]">
                    <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-[10px] font-bold text-[var(--crm-surface)]">{owner.slice(0, 2).toUpperCase()}</span>
                    {owner}
                  </span>
                </SummaryItem>
                <SummaryItem label="Next action" tone="amber">
                  <button type="button" onClick={runNextAction} className="flex max-w-[245px] items-center gap-2 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-warning-soft)] px-3 py-2 text-left text-sm font-bold text-[var(--crm-warning)] hover:brightness-95">
                    <Icon name="schedule" className="shrink-0 text-[18px]" />
                    {nextAction}
                  </button>
                </SummaryItem>
              </div>

              <div className="my-6 border-t border-[var(--crm-border)]" />
              <SectionLabel>Quick actions</SectionLabel>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { closePanels(); onAppointment() }} className="crm-secondary-button flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="event" className="text-[18px]" />Appointment</button>
                <button type="button" onClick={() => { closePanels(); onTask() }} className="crm-secondary-button flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="add_task" className="text-[18px]" />New task</button>
                <button type="button" onClick={openOffer} className="crm-secondary-button flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="request_quote" className="text-[18px]" />{lead.offer_amount ? 'Update offer' : 'Record offer'}</button>
                <button type="button" onClick={openContextPanel} className="crm-secondary-button flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="home_work" className="text-[18px]" />Property</button>
                <button type="button" onClick={() => { closePanels(); onEdit() }} className="crm-secondary-button col-span-2 flex h-11 items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="edit" className="text-[18px]" />Edit contact and property</button>
              </div>
              {lead.offer_amount ? (
                <button type="button" onClick={() => { closePanels(); onContract() }} className="crm-primary-button mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg text-sm font-bold">
                  <Icon name="description" className="text-[18px]" />
                  Create contract
                </button>
              ) : null}
            </div>
          </aside>
        ) : null}

        {activeSection === 'overview' ? (
        <main className="mt-3 grid gap-4 xl:grid-cols-[minmax(240px,0.72fr)_minmax(0,1.65fr)_minmax(300px,0.82fr)]">
          <PropertyOverviewPanel
            lead={lead}
            address={address}
            streetViewUrl={streetViewUrl}
            imageFailed={imageFailed}
            assessedValue={assessedValue}
            onImageError={() => setImageFailed(true)}
            onOpenStreetView={openStreetView}
            onOpenProperty={openPropertyDetails}
          />

          <section className="crm-panel flex h-[min(72dvh,38rem)] min-h-[24rem] flex-col overflow-hidden rounded-xl xl:h-[calc(100vh-300px)] xl:min-h-[560px] xl:max-h-[820px]">
            <CardHeader title="Conversation" icon="forum" />
            <div className="border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-2.5">
              <div className="flex items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" role="group" aria-label="Filter conversation by communication type">
                {COMMUNICATION_FILTERS.map((filter) => (
                  <button
                    key={filter.key}
                    type="button"
                    onClick={() => setCommunicationFilter(filter.key)}
                    aria-pressed={communicationFilter === filter.key}
                    className={cn(
                      'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-bold transition-colors',
                      communicationFilter === filter.key
                        ? 'border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] text-[var(--crm-brand)]'
                        : 'border-transparent text-[var(--crm-text-muted)] hover:border-[var(--crm-border)] hover:bg-[var(--crm-surface-subtle)] hover:text-[var(--crm-ink)]',
                    )}
                  >
                    <Icon name={filter.icon} className="text-[15px]" />
                    {filter.label}
                    <span className={cn('rounded-full px-1.5 py-0.5 text-[9px]', communicationFilter === filter.key ? 'bg-[var(--crm-surface)]' : 'bg-[var(--crm-surface-subtle)]')}>
                      {communicationCounts[filter.key]}
                    </span>
                  </button>
                ))}
                <span className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md bg-[var(--crm-info-soft)] px-2 py-1 text-[10px] font-bold text-[var(--crm-info)]">
                  <Icon name="south" className="text-[13px]" />
                  Newest first
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {visibleActivities.length ? visibleActivities.map((activity) => (
                <TimelineActivity key={activity.id} activity={activity} />
              )) : (
                <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name="forum" className="text-[28px]" /></span>
                  <h3 className="mt-4 font-bold text-[var(--crm-ink)]">No {communicationFilter === 'all' ? 'conversation' : COMMUNICATION_FILTERS.find((filter) => filter.key === communicationFilter)?.label.toLowerCase()} activity yet</h3>
                  <p className="mt-1 max-w-xs text-sm text-[var(--crm-text-muted)]">Choose another communication type or start a new conversation below.</p>
                </div>
              )}
            </div>
            <div className="border-t border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4">
              <div className="overflow-hidden rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-surface)]">
                <div className="flex border-b border-[var(--crm-border)]">
                  {([
                    ['sms', 'Text'],
                    ['email', 'Email'],
                    ['note', 'Internal note'],
                  ] as const).map(([key, label]) => (
                    <button key={key} type="button" onClick={() => setComposeMode(key)} aria-pressed={composeMode === key} className={cn('border-b-2 px-4 py-2.5 text-xs font-bold', composeMode === key ? 'border-[var(--crm-brand)] text-[var(--crm-brand)]' : 'border-transparent text-[var(--crm-text-muted)]')}>
                      {label}
                    </button>
                  ))}
                </div>
                {composeMode === 'email' ? (
                  <input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} placeholder="Subject" className="w-full border-b border-[var(--crm-border)] bg-[var(--crm-surface)] px-4 py-2.5 text-sm text-[var(--crm-text)] outline-none placeholder:text-[var(--crm-text-dim)]" />
                ) : null}
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={composeMode === 'note' ? 'Add context for your team...' : `Write a ${composeMode === 'sms' ? 'text' : 'message'} to ${firstName}...`}
                  className="h-24 w-full resize-none bg-[var(--crm-surface)] px-4 py-3 text-base text-[var(--crm-text)] outline-none placeholder:text-[var(--crm-text-dim)] sm:text-sm"
                />
                {sendError ? <p className="px-4 pb-2 text-xs font-semibold text-[var(--crm-danger)]">{sendError}</p> : null}
                <div className="flex items-center gap-2 border-t border-[var(--crm-border)] px-3 py-2.5">
                  <button type="button" onClick={() => selectSection('documents')} className="flex items-center gap-1.5 text-xs font-semibold text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]"><Icon name="attach_file" className="text-[18px]" />Open documents</button>
                  <button
                    type="button"
                    onClick={() => setMessage(`Hi ${firstName}, I’m following up about ${lead.property_address || 'your property'}. What time works best for a quick conversation?`)}
                    className="flex items-center gap-1.5 text-xs font-semibold text-[var(--crm-text-muted)] hover:text-[var(--crm-brand)]"
                  >
                    <Icon name="bolt" className="text-[18px]" />Use follow-up
                  </button>
                  <button type="button" onClick={sendMessage} disabled={sending || !message.trim()} className="crm-primary-button ml-auto flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-50">
                    <Icon name={sending ? 'hourglass_empty' : 'send'} className="text-[17px]" />
                    {composeMode === 'note' ? 'Add note' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <LeadOpportunityPanel
            leadId={lead.id}
            nextActionTask={nextTask}
            station={lead.station}
            score={score}
            motivationScore={lead.motivation_score}
            estimatedValue={lead.arv ?? assessedValue}
            offerAmount={lead.offer_amount}
            offerMethod={latestOfferMethod}
            phoneAvailable={Boolean(lead.phone)}
            propertyAddress={lead.property_address}
            appointment={appointment}
            appointmentIsPast={appointmentIsPast}
            onCall={onCall}
            onAppointment={onAppointment}
            onAppointmentOutcome={onAppointmentOutcome}
            onOffer={openOffer}
            onContract={onContract}
            onTask={onTask}
            onEdit={onEdit}
          />
        </main>
        ) : (
          <section
            aria-labelledby={`lead-section-${activeSection}`}
            className="crm-panel mt-4 min-h-[22rem] overflow-hidden rounded-xl p-4 sm:min-h-[520px] sm:p-6"
          >
            <div className="mb-5 flex items-center justify-between border-b border-[var(--crm-border)] pb-4">
              <div>
                <p className="crm-eyebrow">Lead workspace</p>
                <h2 id={`lead-section-${activeSection}`} className="mt-1 text-xl font-bold text-[var(--crm-ink)]">
                  {WORKSPACE_SECTIONS.find((section) => section.key === activeSection)?.label}
                </h2>
              </div>
              <button type="button" onClick={() => selectSection('overview')} className="crm-secondary-button flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-bold">
                <Icon name="grid_view" className="text-[17px]" />
                Back to overview
              </button>
            </div>
            {sectionPanels?.[activeSection] || (
              <div className="flex min-h-[360px] flex-col items-center justify-center text-center">
                <Icon name="construction" className="text-[34px] text-[var(--crm-text-dim)]" />
                <p className="mt-3 font-bold text-[var(--crm-ink)]">This workspace section is not available yet.</p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}

function PropertyOverviewPanel({
  lead,
  address,
  streetViewUrl,
  imageFailed,
  assessedValue,
  onImageError,
  onOpenStreetView,
  onOpenProperty,
}: {
  lead: LeadWorkspaceLead
  address: string
  streetViewUrl: string
  imageFailed: boolean
  assessedValue: number | null
  onImageError: () => void
  onOpenStreetView: () => void
  onOpenProperty: () => void
}) {
  const baths = (lead.baths_full || 0) + (lead.baths_half ? 0.5 : 0)

  return (
    <section className="crm-panel flex flex-col overflow-hidden rounded-xl xl:h-[calc(100vh-300px)] xl:min-h-[560px] xl:max-h-[820px]">
      <CardHeader
        title="Property details"
        icon="home_work"
        onTitleClick={onOpenProperty}
        titleActionLabel="Open property details and county records"
      />
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="overflow-hidden rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface)] transition-colors hover:border-[var(--crm-brand-border)]">
          <button
            type="button"
            onClick={onOpenStreetView}
            disabled={!address}
            className="group relative block w-full overflow-hidden text-left disabled:cursor-not-allowed"
            aria-label={address ? `Open Street View for ${address}` : 'Street View unavailable because the property address is missing'}
          >
          {!imageFailed && address ? (
            // Google Street View is a signed dynamic image URL and is intentionally not routed through next/image.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={streetViewUrl}
              alt={`Street view of ${address}`}
              loading="lazy"
              className="h-44 w-full object-cover transition-transform duration-300 group-hover:scale-[1.015] sm:h-auto sm:aspect-[16/10]"
              onError={onImageError}
            />
          ) : (
            <span className="flex h-44 items-center justify-center bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)] sm:h-auto sm:aspect-[16/10]">
              <Icon name="home" className="text-[42px]" />
            </span>
          )}
            {address ? <StreetViewHint /> : null}
          </button>
          <button
            type="button"
            onClick={onOpenProperty}
            className="flex w-full items-center gap-3 border-t border-[var(--crm-border)] px-4 py-3 text-left hover:bg-[var(--crm-surface-subtle)]"
            aria-label="Open property details and county records"
          >
            <span className="min-w-0 flex-1">
              <span className="block font-bold leading-5 text-[var(--crm-ink)]">{lead.property_address || 'Property address missing'}</span>
              <span className="mt-1 block text-xs leading-4 text-[var(--crm-text-muted)]">{[lead.city, lead.state, lead.zip].filter(Boolean).join(', ') || 'Location not recorded'}</span>
            </span>
            <Icon name="chevron_right" className="shrink-0 text-[18px] text-[var(--crm-brand)]" />
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-2">
          {[
            { label: 'Beds', value: lead.beds?.toString() || '—', icon: 'bed' },
            { label: 'Baths', value: baths ? String(baths) : '—', icon: 'bathtub' },
            { label: 'Square feet', value: lead.sqft?.toLocaleString() || '—', icon: 'square_foot' },
            { label: 'Year built', value: lead.year_built?.toString() || '—', icon: 'calendar_today' },
          ].map((detail) => (
            <div key={detail.label} className="rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-3">
              <dt className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">
                <Icon name={detail.icon} className="text-[13px] text-[var(--crm-info)]" />
                {detail.label}
              </dt>
              <dd className="mt-1 text-sm font-black text-[var(--crm-ink)]">{detail.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 rounded-xl border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] p-4">
          <SectionLabel>Value and source</SectionLabel>
          <dl className="mt-3 space-y-3 text-sm">
            <DataRow label="Estimated value" value={formatMoney(lead.arv ?? assessedValue)} />
            <DataRow label="Current offer" value={formatMoney(lead.offer_amount)} />
            <DataRow label="Lead source" value={lead.source || 'Unknown'} />
          </dl>
        </div>

        <button
          type="button"
          onClick={onOpenProperty}
          className="crm-secondary-button mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold"
        >
          <Icon name="open_in_new" className="text-[16px]" />
          Open full property details
        </button>
      </div>
    </section>
  )
}

function StreetViewHint() {
  return (
    <span className="pointer-events-none absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-black/70 px-2.5 py-1.5 text-[10px] font-black uppercase tracking-[0.08em] text-white shadow-lg backdrop-blur-sm">
      <Icon name="360" className="text-[16px]" />
      Open Street View
    </span>
  )
}

function StreetViewModal({ address, onClose }: { address: string; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-6"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="lead-street-view-title"
        className="crm-panel-raised w-full max-w-5xl overflow-hidden rounded-2xl shadow-2xl"
      >
        <header className="flex items-center gap-3 border-b border-[var(--crm-border)] px-4 py-3 sm:px-5">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-info-soft)] text-[var(--crm-info)]">
            <Icon name="360" className="text-[22px]" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="crm-eyebrow">Interactive property view</p>
            <h2 id="lead-street-view-title" className="truncate text-base font-black text-[var(--crm-ink)] sm:text-lg">Street View · {address}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            autoFocus
            aria-label="Close Street View"
            className="crm-icon-button flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="h-[min(72vh,620px)] w-full">
          <StreetViewPanel address={address} height="100%" />
        </div>
      </section>
    </div>
  )
}

function ActionButton({ icon, label, onClick, disabled, tone }: { icon: string; label: string; onClick: () => void; disabled?: boolean; tone: 'teal' | 'blue' | 'violet' }) {
  const toneClass = {
    teal: 'border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-[var(--crm-success)] hover:brightness-95',
    blue: 'border-[var(--crm-border-strong)] bg-[var(--crm-info-soft)] text-[var(--crm-info)] hover:brightness-95',
    violet: 'border-[var(--crm-border-strong)] bg-[var(--crm-violet-soft)] text-[var(--crm-violet)] hover:brightness-95',
  }[tone]
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} className={cn('flex h-9 min-w-[88px] items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-bold transition-colors sm:text-sm disabled:cursor-not-allowed disabled:border-[var(--crm-border)] disabled:bg-[var(--crm-surface)] disabled:text-[var(--crm-text-disabled)]', toneClass)}>
      <Icon name={icon} className="text-[17px]" />
      {label}
    </button>
  )
}

function SummaryItem({ label, children, tone }: { label: string; children: React.ReactNode; tone: 'teal' | 'blue' | 'amber' }) {
  const toneClass = {
    teal: 'border-l-[var(--crm-border-strong)] bg-[var(--crm-surface)]',
    blue: 'border-l-[var(--crm-border-strong)] bg-[var(--crm-surface)]',
    amber: 'border-l-[var(--crm-warning)] bg-[var(--crm-warning-soft)]',
  }[tone]
  return (
    <div className={cn('flex min-h-11 items-center gap-3 rounded-lg border border-[var(--crm-border)] border-l-[3px] px-3', toneClass)}>
      <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">{label}</span>
      <div className="ml-auto">{children}</div>
    </div>
  )
}

function CardHeader({
  id,
  title,
  icon,
  onMore,
  onClose,
  onTitleClick,
  titleActionLabel,
}: {
  id?: string
  title: string
  icon: string
  onMore?: () => void
  onClose?: () => void
  onTitleClick?: () => void
  titleActionLabel?: string
}) {
  const iconTone = icon === 'person' || icon === 'forum' || icon === 'home_work'
    ? 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
    : icon === 'paid'
      ? 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]'
      : 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]'
  return (
    <div className="flex h-13 items-center border-b border-[var(--crm-border)] px-5">
      {onTitleClick ? (
        <button
          type="button"
          onClick={onTitleClick}
          aria-label={titleActionLabel || `Open ${title}`}
          className="group flex min-w-0 items-center rounded-lg pr-2 text-left hover:bg-[var(--crm-surface-subtle)]"
        >
          <span className={cn('mr-2 flex h-8 w-8 items-center justify-center rounded-lg', iconTone)}><Icon name={icon} className="text-[18px]" /></span>
          <span id={id} role="heading" aria-level={2} className="text-base font-bold text-[var(--crm-ink)]">{title}</span>
          <Icon name="chevron_right" className="ml-1 text-[17px] text-[var(--crm-text-dim)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--crm-brand)]" />
        </button>
      ) : (
        <>
          <span className={cn('mr-2 flex h-8 w-8 items-center justify-center rounded-lg', iconTone)}><Icon name={icon} className="text-[18px]" /></span>
          <h2 id={id} className="text-base font-bold text-[var(--crm-ink)]">{title}</h2>
        </>
      )}
      <div className="ml-auto flex items-center gap-1">
        {onMore ? <button type="button" onClick={onMore} aria-label={`Edit ${title}`} className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="edit" className="text-[18px]" /></button> : null}
        {onClose ? <button type="button" onClick={onClose} autoFocus aria-label={`Close ${title}`} className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="close" /></button> : null}
      </div>
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--crm-text-muted)]">{children}</p>
}

function DataRow({ label, value, accent, compact }: { label: string; value: string; accent?: boolean; compact?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', compact && 'flex-col gap-0.5')}>
      <dt className="text-[var(--crm-text-muted)]">{label}</dt>
      <dd className={cn('min-w-0 break-all text-right font-semibold text-[var(--crm-text)]', accent && 'text-[var(--crm-info)]', compact && 'text-left')}>{value}</dd>
    </div>
  )
}

function TimelineActivity({ activity }: { activity: LeadWorkspaceActivity }) {
  const meta = ACTIVITY_META[activity.activity_type] || { icon: 'timeline', label: activity.activity_type.replace(/_/g, ' '), tone: 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]' }
  const direction = directionFor(activity)
  const isOutbound = direction === 'Outbound'
  const isCall = activity.activity_type === 'call'
  const text = leadActivityText(activity)
  const recordingUrl = playableRecordingUrl(activity.metadata)
  return (
    <article className="grid grid-cols-[92px_34px_1fr] gap-3">
      <time className="pt-1 text-right text-[11px] leading-4 text-[var(--crm-text-muted)]">{formatActivityDate(activity.created_at)}</time>
      <div className="relative flex justify-center">
        <span className="absolute bottom-[-22px] top-8 w-px bg-[var(--crm-border)]" />
        <span className={cn('relative z-10 flex h-8 w-8 items-center justify-center rounded-full', meta.tone)}><Icon name={meta.icon} className="text-[17px]" /></span>
      </div>
      <div className={cn('rounded-lg border p-3', activity.activity_type === 'note' || activity.activity_type === 'agent_note' ? 'border-[var(--crm-violet)]/25 bg-[var(--crm-violet-soft)]' : isOutbound ? 'border-[var(--crm-border)] bg-[var(--crm-info-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-[var(--crm-ink)]">{direction ? `${direction} ${meta.label}` : meta.label}</span>
          {activity.agent ? <span className="text-[10px] text-[var(--crm-text-muted)]">by {toProperCase(activity.agent)}</span> : null}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-[var(--crm-text)]">{text}</p>
        {isCall ? recordingUrl ? (
          <><audio className="mt-3 w-full accent-[var(--crm-brand)]" controls preload="metadata" src={recordingUrl}>
            Your browser does not support call recording playback.
          </audio><CallReviewSubmitButton activityId={activity.id} recordingUrl={recordingUrl} /></>
        ) : (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[var(--crm-border)] bg-[var(--crm-surface-subtle)] px-3 py-2 text-xs font-semibold text-[var(--crm-text-muted)]">
            <Icon name="phone_in_talk" className="text-[17px] text-[var(--crm-brand)]" />
            No recording available
          </div>
        ) : null}
      </div>
    </article>
  )
}
