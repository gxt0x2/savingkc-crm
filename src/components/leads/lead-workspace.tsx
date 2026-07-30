'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Icon } from '@/components/ui/icon'
import { StageSelector } from '@/components/leads/stage-selector'
import { formatPhone, toProperCase } from '@/lib/format'
import { cn } from '@/lib/utils'

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
  onStageChange: (station: string) => void
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

const STAGES = [
  { keys: ['new'], label: 'New' },
  { keys: ['contacted', 'lead', 'leads'], label: 'Contacted' },
  { keys: ['qualified', 'qualifying', 'opportunity'], label: 'Qualified' },
  { keys: ['offer_made', 'negotiations', 'offer'], label: 'Offer' },
  { keys: ['under_contract', 'in_closing', 'contract'], label: 'Contract' },
]

const ACTIVITY_META: Record<string, { icon: string; label: string; tone: string }> = {
  sms: { icon: 'chat_bubble', label: 'SMS', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  call: { icon: 'call', label: 'Call', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  voicemail: { icon: 'voicemail', label: 'Voicemail', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
  email: { icon: 'mail', label: 'Email', tone: 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]' },
  note: { icon: 'description', label: 'Internal note', tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' },
  agent_note: { icon: 'description', label: 'Internal note', tone: 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]' },
  task: { icon: 'check_circle', label: 'Task', tone: 'bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]' },
  appointment: { icon: 'calendar_month', label: 'Appointment', tone: 'bg-[var(--crm-violet-soft)] text-[var(--crm-violet)]' },
}

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

function activityText(activity: LeadWorkspaceActivity) {
  const raw = activity.description?.trim() || ''
  const notification = raw.match(/just texted:\s*["“]([\s\S]*?)["”]\s*(?:—|$)/i)
  if (notification?.[1]) return notification[1].trim()
  return raw || (activity.activity_type === 'call' ? 'Call activity' : 'No details recorded')
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
  sectionPanels,
}: LeadWorkspaceProps) {
  const [activeSection, setActiveSection] = useState<LeadWorkspaceSection>('overview')
  const [composeMode, setComposeMode] = useState<'sms' | 'email' | 'note'>('sms')
  const [message, setMessage] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const sectionHeadingRef = useRef<HTMLDivElement>(null)
  const name = toProperCase(lead.full_name) || 'Unknown contact'
  const firstName = name.split(/\s+/)[0]
  const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  const owner = toProperCase(lead.assigned_agent) || 'Unassigned'
  const address = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x500&location=${encodeURIComponent(address)}&fov=90&pitch=4&key=${process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''}`
  const stageIndex = Math.max(0, STAGES.findIndex((stage) => stage.keys.includes((lead.station || 'new').toLowerCase())))
  const visibleActivities = useMemo(() => {
    const communicationTypes = new Set(['sms', 'call', 'voicemail', 'email', 'note', 'agent_note'])
    const normalized: LeadWorkspaceActivity[] = []
    for (const activity of activities) {
      if (!communicationTypes.has(activity.activity_type)) continue
      const body = activityText(activity).toLowerCase().replace(/\s+/g, ' ')
      const timestamp = new Date(activity.created_at).getTime()
      const duplicateIndex = normalized.findIndex((candidate) => {
        const candidateTime = new Date(candidate.created_at).getTime()
        return candidate.activity_type === activity.activity_type
          && activityText(candidate).toLowerCase().replace(/\s+/g, ' ') === body
          && Math.abs(candidateTime - timestamp) < 120_000
      })
      if (duplicateIndex < 0) {
        normalized.push(activity)
        continue
      }
      const candidateHasDirection = Boolean(normalized[duplicateIndex].metadata?.direction)
      const activityHasDirection = Boolean(activity.metadata?.direction)
      if (activityHasDirection && !candidateHasDirection) normalized[duplicateIndex] = activity
    }
    return normalized.slice(0, 10)
  }, [activities])
  const nextTask = activities.find((activity) => activity.activity_type === 'task')
  const appointmentIsPast = Boolean(appointment && new Date(appointment.scheduledAt).getTime() < Date.now())
  const nextAction = appointmentIsPast
    ? 'Record appointment outcome'
    : appointment
      ? `Appointment ${new Date(appointment.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : nextTask?.description || 'Define the next action'

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
      <div className="mx-auto max-w-[1560px] px-5 pb-8 pt-6 xl:px-8">
        <header className="crm-panel-raised relative overflow-hidden rounded-xl px-6 py-5">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/contacts" className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg" aria-label="Back to contacts">
                  <Icon name="arrow_back" />
                </Link>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[var(--crm-brand)] text-base font-bold text-white ring-4 ring-[var(--crm-brand-soft)]">
                  {initials || 'SK'}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-bold tracking-[-0.03em] text-[var(--crm-ink)] sm:text-[30px]">{name}</h1>
                    <span className="inline-flex items-center gap-1 rounded-md border border-[var(--crm-brand-border)] bg-[var(--crm-brand-soft)] px-2 py-1 text-xs font-bold text-[var(--crm-brand)]">
                      <Icon name="local_fire_department" className="text-[15px]" />
                      {(lead.priority || '').toLowerCase() === 'hot' ? 'Hot Lead' : 'Active Lead'}
                    </span>
                    <button type="button" onClick={onEdit} className="crm-icon-button flex h-9 w-9 items-center justify-center rounded-lg" aria-label="Edit contact">
                      <Icon name="edit" className="text-[19px]" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-[var(--crm-text-muted)]">
                    {address ? <span className="flex items-center gap-1.5"><Icon name="location_on" className="text-[18px]" />{address}</span> : null}
                    {lead.phone ? <button type="button" onClick={onCall} className="flex items-center gap-1.5 hover:text-[var(--crm-brand)]" aria-label={`Call ${name}`}><Icon name="call" className="text-[17px]" />{formatPhone(lead.phone)}</button> : null}
                    {lead.email ? <button type="button" onClick={onEmail} className="flex items-center gap-1.5 hover:text-[var(--crm-brand)]" aria-label={`Email ${name}`}><Icon name="mail" className="text-[17px]" />{lead.email}</button> : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <ActionButton icon="call" label="Call" onClick={onCall} disabled={!lead.phone} tone="teal" />
              <ActionButton icon="chat_bubble" label="Text" onClick={onText} disabled={!lead.phone} tone="blue" />
              <ActionButton icon="mail" label="Email" onClick={onEmail} disabled={!lead.email} tone="violet" />
              <button type="button" onClick={onContract} className="crm-primary-button flex h-11 items-center gap-2 rounded-lg px-4 text-sm font-bold">
                <Icon name="description" className="text-[19px]" />
                Create contract
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 border-t border-[var(--crm-border)] pt-4 md:grid-cols-3">
            <SummaryItem label="Stage" tone="teal">
              <StageSelector
                leadId={lead.id}
                station={lead.station}
                size="md"
                variant="workspace"
                onAppointmentRequired={onAppointment}
                onChange={(next) => onStageChange(next)}
              />
            </SummaryItem>
            <SummaryItem label="Owner" tone="blue">
              <span className="flex items-center gap-2 font-semibold text-[var(--crm-text)]">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[var(--crm-charcoal)] text-[10px] font-bold text-[var(--crm-surface)]">{owner.slice(0, 2).toUpperCase()}</span>
                {owner}
              </span>
            </SummaryItem>
            <SummaryItem label="Next action" tone="amber">
              <button type="button" onClick={appointmentIsPast ? onAppointmentOutcome : appointment ? onAppointment : onTask} className="flex items-center gap-2 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-warning-soft)] px-3 py-2 text-sm font-bold text-[var(--crm-warning)] hover:brightness-95">
                <Icon name="schedule" className="text-[18px]" />
                {nextAction}
              </button>
            </SummaryItem>
          </div>
        </header>

        <nav ref={sectionHeadingRef} className="crm-panel sticky top-0 z-20 mt-4 grid scroll-mt-4 grid-cols-3 overflow-hidden rounded-xl md:grid-cols-6" aria-label="Lead workspace sections">
          {WORKSPACE_SECTIONS.map(({ key, icon, label, activeTone, iconTone }) => (
            <button
              key={key}
              type="button"
              onClick={() => selectSection(key)}
              aria-current={activeSection === key ? 'page' : undefined}
              className={cn(
                'flex h-14 items-center justify-center gap-2 border-b-2 px-2 text-xs font-semibold transition-colors md:text-sm',
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

        {activeSection === 'overview' ? (
        <main className="mt-4 grid gap-4 xl:grid-cols-[0.92fr_1.45fr_1.05fr]">
          <section className="crm-panel overflow-hidden rounded-xl">
            <CardHeader title="Contact & Property" icon="person" onMore={onEdit} />
            <div className="p-5">
              <SectionLabel>Contact</SectionLabel>
              <dl className="mt-3 space-y-3 text-sm">
                <DataRow label="Phone" value={lead.phone ? formatPhone(lead.phone) : '—'} accent />
                <DataRow label="Email" value={lead.email || '—'} accent />
                <DataRow label="Owner" value={owner} />
                <DataRow label="Preferred contact" value={lead.phone ? 'Text or call' : lead.email ? 'Email' : 'Not set'} />
              </dl>

              <div className="my-5 border-t border-[var(--crm-border)]" />
              <SectionLabel>Property snapshot</SectionLabel>
              <button type="button" onClick={onOpenProperty} className="mt-3 w-full overflow-hidden rounded-lg border border-[var(--crm-border)] text-left hover:border-[var(--crm-brand-border)]" aria-label="Open property details">
                {!imageFailed && address ? (
                  // Google Street View is a signed dynamic image URL and is intentionally not routed through next/image.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={streetViewUrl}
                    alt={`Street view of ${address}`}
                    className="h-36 w-full object-cover"
                    onError={() => setImageFailed(true)}
                  />
                ) : (
                  <span className="flex h-36 items-center justify-center bg-[var(--crm-surface-subtle)] text-[var(--crm-text-muted)]">
                    <Icon name="home" className="text-[42px]" />
                  </span>
                )}
                <span className="block px-4 py-3">
                  <span className="block font-bold text-[var(--crm-ink)]">{lead.property_address || 'Property address missing'}</span>
                  <span className="mt-1 block text-xs text-[var(--crm-text-muted)]">{[lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}</span>
                </span>
              </button>
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
          </section>

          <section className="crm-panel flex h-[calc(100vh-375px)] min-h-[540px] max-h-[720px] flex-col overflow-hidden rounded-xl">
            <CardHeader title="Conversation" icon="forum" />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {visibleActivities.length ? visibleActivities.map((activity) => (
                <TimelineActivity key={activity.id} activity={activity} />
              )) : (
                <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--crm-info-soft)] text-[var(--crm-info)]"><Icon name="forum" className="text-[28px]" /></span>
                  <h3 className="mt-4 font-bold text-[var(--crm-ink)]">No conversation activity yet</h3>
                  <p className="mt-1 max-w-xs text-sm text-[var(--crm-text-muted)]">Call, text, email, and internal notes will appear together here.</p>
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
                  className="h-24 w-full resize-none bg-[var(--crm-surface)] px-4 py-3 text-sm text-[var(--crm-text)] outline-none placeholder:text-[var(--crm-text-dim)]"
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

          <section className="crm-panel overflow-hidden rounded-xl">
            <CardHeader title="Opportunity" icon="paid" />
            <div className="p-5">
              <SectionLabel>Deal stage</SectionLabel>
              <div className="mt-5 flex items-start">
                {STAGES.map((stage, index) => {
                  const complete = index < stageIndex
                  const current = index === stageIndex
                  return (
                    <div key={stage.label} className="relative flex flex-1 flex-col items-center">
                      {index > 0 ? <span className={cn('absolute right-1/2 top-3 h-0.5 w-full', index <= stageIndex ? 'bg-[var(--crm-success)]' : 'bg-[var(--crm-border)]')} /> : null}
                      <span className={cn('relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold', complete ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-white' : current ? 'border-[var(--crm-success)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-[var(--crm-text-dim)]')}>
                        {complete ? <Icon name="check" className="text-[14px]" /> : current ? <span className="h-2 w-2 rounded-full bg-[var(--crm-success)]" /> : null}
                      </span>
                      <span className={cn('mt-2 text-center text-[10px] font-semibold', current ? 'text-[var(--crm-success)]' : 'text-[var(--crm-text-muted)]')}>{stage.label}</span>
                    </div>
                  )
                })}
              </div>

              <dl className="mt-7 space-y-4 border-t border-[var(--crm-border)] pt-5 text-sm">
                <DataRow label="Motivation score" value={`${score ?? lead.motivation_score ?? '—'}${score != null || lead.motivation_score != null ? ' / 100' : ''}`} accent />
                <DataRow label="Estimated value" value={formatMoney(lead.arv ?? assessedValue)} />
                <DataRow label="Our offer" value={formatMoney(lead.offer_amount)} />
              </dl>

              <div className="my-6 border-t border-[var(--crm-border)]" />
              <SectionLabel>Next steps</SectionLabel>
              <div className="mt-3 space-y-2">
                <NextStep label="Call seller" value={lead.phone ? 'Ready now' : 'Phone missing'} onClick={onCall} disabled={!lead.phone} />
                <NextStep
                  label={appointmentIsPast ? 'Record appointment outcome' : 'Schedule appointment'}
                  value={appointmentIsPast ? 'Required' : appointment ? 'Scheduled' : 'Not set'}
                  onClick={appointmentIsPast ? onAppointmentOutcome : onAppointment}
                />
                <NextStep label="Review offer" value={lead.offer_amount ? formatMoney(lead.offer_amount) : 'Not set'} onClick={onContract} />
              </div>

              {appointment ? (
                <button type="button" onClick={appointmentIsPast ? onAppointmentOutcome : onAppointment} className="mt-5 flex w-full items-start gap-3 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-violet-soft)] p-4 text-left hover:brightness-95">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--crm-violet)] text-white"><Icon name="calendar_month" /></span>
                  <span>
                    <span className="block text-xs font-black uppercase tracking-[0.08em] text-[var(--crm-violet)]">{appointmentIsPast ? 'Appointment outcome required' : 'Appointment scheduled'}</span>
                    <span className="mt-1 block text-sm font-bold text-[var(--crm-ink)]">{new Date(appointment.scheduledAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="mt-0.5 block text-xs text-[var(--crm-text-muted)]">{appointment.address || lead.property_address}</span>
                  </span>
                </button>
              ) : (
                <button type="button" onClick={onAppointment} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--crm-brand-border)] px-4 py-4 text-sm font-bold text-[var(--crm-brand)] hover:bg-[var(--crm-brand-soft)]">
                  <Icon name="event" />
                  Schedule appointment
                </button>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button type="button" onClick={onTask} className="crm-secondary-button flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="add_task" />New task</button>
                <button type="button" onClick={onEdit} className="crm-secondary-button flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-bold"><Icon name="edit" />More details</button>
              </div>
            </div>
          </section>
        </main>
        ) : (
          <section
            aria-labelledby={`lead-section-${activeSection}`}
            className="crm-panel mt-4 min-h-[520px] overflow-hidden rounded-xl p-5 sm:p-6"
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

function ActionButton({ icon, label, onClick, disabled, tone }: { icon: string; label: string; onClick: () => void; disabled?: boolean; tone: 'teal' | 'blue' | 'violet' }) {
  const toneClass = {
    teal: 'border-[var(--crm-border-strong)] bg-[var(--crm-success-soft)] text-[var(--crm-success)] hover:brightness-95',
    blue: 'border-[var(--crm-border-strong)] bg-[var(--crm-info-soft)] text-[var(--crm-info)] hover:brightness-95',
    violet: 'border-[var(--crm-border-strong)] bg-[var(--crm-violet-soft)] text-[var(--crm-violet)] hover:brightness-95',
  }[tone]
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} className={cn('flex h-11 min-w-[104px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:border-[var(--crm-border)] disabled:bg-[var(--crm-surface)] disabled:text-[var(--crm-text-disabled)]', toneClass)}>
      <Icon name={icon} className="text-[19px]" />
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
    <div className={cn('flex min-h-14 items-center gap-4 rounded-lg border border-[var(--crm-border)] border-l-4 px-4', toneClass)}>
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-[var(--crm-text-muted)]">{label}</span>
      <div className="ml-auto">{children}</div>
    </div>
  )
}

function CardHeader({ title, icon, onMore }: { title: string; icon: string; onMore?: () => void }) {
  const iconTone = icon === 'person'
    ? 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
    : icon === 'forum'
      ? 'bg-[var(--crm-info-soft)] text-[var(--crm-info)]'
      : 'bg-[var(--crm-warning-soft)] text-[var(--crm-warning)]'
  return (
    <div className="flex h-13 items-center border-b border-[var(--crm-border)] px-5">
      <span className={cn('mr-2 flex h-8 w-8 items-center justify-center rounded-lg', iconTone)}><Icon name={icon} className="text-[18px]" /></span>
      <h2 className="text-base font-bold text-[var(--crm-ink)]">{title}</h2>
      {onMore ? <button type="button" onClick={onMore} aria-label={`Edit ${title}`} className="crm-icon-button ml-auto flex h-9 w-9 items-center justify-center rounded-lg"><Icon name="more_vert" /></button> : null}
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
  const text = activityText(activity)
  const recordingUrl = typeof activity.metadata?.recording_url === 'string'
    ? activity.metadata.recording_url
    : typeof activity.metadata?.recordingUrl === 'string'
      ? activity.metadata.recordingUrl
      : typeof activity.metadata?.recordingSid === 'string'
        ? `/api/recordings/${activity.metadata.recordingSid}`
        : null
  return (
    <article className="grid grid-cols-[92px_34px_1fr] gap-3">
      <time className="pt-1 text-right text-[11px] leading-4 text-[var(--crm-text-muted)]">{formatActivityDate(activity.created_at)}</time>
      <div className="relative flex justify-center">
        <span className="absolute bottom-[-22px] top-8 w-px bg-[var(--crm-border)]" />
        <span className={cn('relative z-10 flex h-8 w-8 items-center justify-center rounded-full', meta.tone)}><Icon name={meta.icon} className="text-[17px]" /></span>
      </div>
      <div className={cn('rounded-lg border p-3', activity.activity_type === 'note' || activity.activity_type === 'agent_note' ? 'border-[var(--crm-border-strong)] bg-[var(--crm-warning-soft)]' : isOutbound ? 'border-[var(--crm-border)] bg-[var(--crm-info-soft)]' : 'border-[var(--crm-border)] bg-[var(--crm-surface-subtle)]')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-[var(--crm-ink)]">{direction ? `${direction} ${meta.label}` : meta.label}</span>
          {activity.agent ? <span className="text-[10px] text-[var(--crm-text-muted)]">by {toProperCase(activity.agent)}</span> : null}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-[var(--crm-text)]">{text}</p>
        {isCall ? recordingUrl ? (
          <audio className="mt-3 w-full accent-[var(--crm-brand)]" controls preload="metadata" src={recordingUrl}>
            Your browser does not support call recording playback.
          </audio>
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

function NextStep({ label, value, onClick, disabled }: { label: string; value: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[var(--crm-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-55">
      <span className="h-5 w-5 rounded-full border-2 border-[var(--crm-border-strong)]" />
      <span className="text-sm font-semibold text-[var(--crm-text)]">{label}</span>
      <span className="ml-auto text-xs font-bold text-[var(--crm-warning)]">{value}</span>
    </button>
  )
}
