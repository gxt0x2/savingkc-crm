'use client'

import { useMemo, useState } from 'react'
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
  onTask: () => void
  onContract: () => void
  onOpenProperty: () => void
  onRefresh: () => void
  onStageChange: (station: string) => void
}

const STAGES = [
  { keys: ['new'], label: 'New' },
  { keys: ['contacted', 'lead', 'leads'], label: 'Contacted' },
  { keys: ['qualified', 'qualifying', 'opportunity'], label: 'Qualified' },
  { keys: ['offer_made', 'negotiations', 'offer'], label: 'Offer' },
  { keys: ['under_contract', 'in_closing', 'contract'], label: 'Contract' },
]

const ACTIVITY_META: Record<string, { icon: string; label: string; tone: string }> = {
  sms: { icon: 'chat_bubble', label: 'SMS', tone: 'bg-[#eaf2ff] text-[#1f5fbf]' },
  call: { icon: 'call', label: 'Call', tone: 'bg-[#fff0f1] text-[#c9232d]' },
  voicemail: { icon: 'voicemail', label: 'Voicemail', tone: 'bg-[#f4efff] text-[#6941c6]' },
  email: { icon: 'mail', label: 'Email', tone: 'bg-[#edf7ff] text-[#1769aa]' },
  note: { icon: 'description', label: 'Internal note', tone: 'bg-[#fff5dc] text-[#a15c00]' },
  agent_note: { icon: 'description', label: 'Internal note', tone: 'bg-[#fff5dc] text-[#a15c00]' },
  task: { icon: 'check_circle', label: 'Task', tone: 'bg-[#f1f3f5] text-[#4b5563]' },
  appointment: { icon: 'calendar_month', label: 'Appointment', tone: 'bg-[#fff0f1] text-[#c9232d]' },
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
  onTask,
  onContract,
  onOpenProperty,
  onRefresh,
  onStageChange,
}: LeadWorkspaceProps) {
  const [composeMode, setComposeMode] = useState<'sms' | 'email' | 'note'>('sms')
  const [message, setMessage] = useState('')
  const [emailSubject, setEmailSubject] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [imageFailed, setImageFailed] = useState(false)
  const name = toProperCase(lead.full_name) || 'Unknown contact'
  const firstName = name.split(/\s+/)[0]
  const initials = name.split(/\s+/).slice(0, 2).map((word) => word[0]).join('').toUpperCase()
  const owner = toProperCase(lead.assigned_agent) || 'Unassigned'
  const address = [lead.property_address, lead.city, lead.state, lead.zip].filter(Boolean).join(', ')
  const streetViewUrl = `https://maps.googleapis.com/maps/api/streetview?size=800x500&location=${encodeURIComponent(address)}&fov=90&pitch=4&key=${process.env.NEXT_PUBLIC_GMAPS_KEY ?? ''}`
  const stageIndex = Math.max(0, STAGES.findIndex((stage) => stage.keys.includes((lead.station || 'new').toLowerCase())))
  const visibleActivities = useMemo(() => activities.slice(0, 10), [activities])
  const nextTask = activities.find((activity) => activity.activity_type === 'task')
  const nextAction = appointment
    ? `Appointment ${new Date(appointment.scheduledAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : nextTask?.description || 'Define the next action'

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
    <div className="h-full overflow-y-auto bg-[#f6f7f9]">
      <div className="mx-auto max-w-[1560px] px-5 pb-8 pt-6 xl:px-8">
        <header className="rounded-xl border border-[#d9dfe6] bg-white px-6 py-5 shadow-[0_1px_3px_rgba(16,24,40,0.04)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/contacts" className="flex h-9 w-9 items-center justify-center rounded-md border border-[#d4dae1] text-[#344054] hover:bg-[#f7f8fa]" aria-label="Back to contacts">
                  <Icon name="arrow_back" />
                </Link>
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#df3038] text-base font-black text-white shadow-[0_0_0_4px_#fff0f1]">
                  {initials || 'SK'}
                </div>
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-2xl font-black tracking-[-0.03em] text-[#111827] sm:text-[30px]">{name}</h1>
                    <span className="inline-flex items-center gap-1 rounded-md border border-[#f7c3c6] bg-[#fff1f2] px-2 py-1 text-xs font-bold text-[#c9232d]">
                      <Icon name="local_fire_department" className="text-[15px]" />
                      {(lead.priority || '').toLowerCase() === 'hot' ? 'Hot Lead' : 'Active Lead'}
                    </span>
                    <button onClick={onEdit} className="text-[#667085] hover:text-[#df3038]" aria-label="Edit contact">
                      <Icon name="edit" className="text-[19px]" />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-[#475467]">
                    {address ? <span className="flex items-center gap-1.5"><Icon name="location_on" className="text-[18px]" />{address}</span> : null}
                    {lead.phone ? <a href={`tel:${lead.phone}`} className="flex items-center gap-1.5 hover:text-[#c9232d]"><Icon name="call" className="text-[17px]" />{formatPhone(lead.phone)}</a> : null}
                    {lead.email ? <a href={`mailto:${lead.email}`} className="flex items-center gap-1.5 hover:text-[#c9232d]"><Icon name="mail" className="text-[17px]" />{lead.email}</a> : null}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <ActionButton icon="call" label="Call" onClick={onCall} disabled={!lead.phone} />
              <ActionButton icon="chat_bubble" label="Text" onClick={onText} disabled={!lead.phone} />
              <ActionButton icon="mail" label="Email" onClick={onEmail} disabled={!lead.email} />
              <button onClick={onContract} className="flex h-11 items-center gap-2 rounded-md bg-[#df3038] px-4 text-sm font-bold text-white shadow-[0_4px_12px_rgba(223,48,56,0.18)] hover:bg-[#c9232d]">
                <Icon name="description" className="text-[19px]" />
                Create contract
              </button>
            </div>
          </div>

          <div className="mt-5 grid gap-3 border-t border-[#e4e7ec] pt-4 md:grid-cols-3">
            <SummaryItem label="Stage">
              <StageSelector
                leadId={lead.id}
                station={lead.station}
                size="md"
                variant="workspace"
                onAppointmentRequired={onAppointment}
                onChange={(next) => onStageChange(next)}
              />
            </SummaryItem>
            <SummaryItem label="Owner">
              <span className="flex items-center gap-2 font-semibold text-[#1f2937]">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#17191d] text-[10px] font-bold text-white">{owner.slice(0, 2).toUpperCase()}</span>
                {owner}
              </span>
            </SummaryItem>
            <SummaryItem label="Next action">
              <button onClick={appointment ? onAppointment : onTask} className="flex items-center gap-2 rounded-md bg-[#fff5e5] px-3 py-2 text-sm font-bold text-[#9a5800] hover:bg-[#ffedcc]">
                <Icon name="schedule" className="text-[18px]" />
                {nextAction}
              </button>
            </SummaryItem>
          </div>
        </header>

        <main className="mt-4 grid gap-4 xl:grid-cols-[0.92fr_1.45fr_1.05fr]">
          <section className="overflow-hidden rounded-xl border border-[#d9dfe6] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.04)]">
            <CardHeader title="Contact & Property" icon="person" onMore={onEdit} />
            <div className="p-5">
              <SectionLabel>Contact</SectionLabel>
              <dl className="mt-3 space-y-3 text-sm">
                <DataRow label="Phone" value={lead.phone ? formatPhone(lead.phone) : '—'} accent />
                <DataRow label="Email" value={lead.email || '—'} accent />
                <DataRow label="Owner" value={owner} />
                <DataRow label="Preferred contact" value={lead.phone ? 'Text or call' : lead.email ? 'Email' : 'Not set'} />
              </dl>

              <div className="my-5 border-t border-[#e4e7ec]" />
              <SectionLabel>Property snapshot</SectionLabel>
              <button onClick={onOpenProperty} className="mt-3 w-full overflow-hidden rounded-lg border border-[#e2e6eb] text-left hover:border-[#efb4b8]">
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
                  <span className="flex h-36 items-center justify-center bg-[linear-gradient(135deg,#f4f5f7,#e6e8ec)] text-[#667085]">
                    <Icon name="home" className="text-[42px]" />
                  </span>
                )}
                <span className="block px-4 py-3">
                  <span className="block font-bold text-[#111827]">{lead.property_address || 'Property address missing'}</span>
                  <span className="mt-1 block text-xs text-[#667085]">{[lead.city, lead.state, lead.zip].filter(Boolean).join(', ')}</span>
                </span>
              </button>
              <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                <DataRow label="Beds" value={lead.beds?.toString() || '—'} compact />
                <DataRow label="Baths" value={((lead.baths_full || 0) + (lead.baths_half ? 0.5 : 0)).toString() || '—'} compact />
                <DataRow label="Sq Ft" value={lead.sqft?.toLocaleString() || '—'} compact />
                <DataRow label="Year built" value={lead.year_built?.toString() || '—'} compact />
              </dl>
              <div className="my-5 border-t border-[#e4e7ec]" />
              <DataRow label="Source" value={lead.source || 'Unknown'} />
              <div className="mt-5">
                <SectionLabel>Tags</SectionLabel>
                <div className="mt-2 flex flex-wrap gap-2">
                  {[lead.priority === 'hot' ? 'Hot Lead' : null, lead.source, lead.station].filter(Boolean).map((tag) => (
                    <span key={tag} className="rounded-md border border-[#efb4b8] bg-[#fff7f7] px-2.5 py-1 text-xs font-semibold capitalize text-[#b91c26]">
                      {String(tag).replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </section>

          <section className="flex min-h-[720px] flex-col overflow-hidden rounded-xl border border-[#d9dfe6] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.04)]">
            <CardHeader title="Conversation" icon="forum" />
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
              {visibleActivities.length ? visibleActivities.map((activity) => (
                <TimelineActivity key={activity.id} activity={activity} />
              )) : (
                <div className="flex h-full min-h-72 flex-col items-center justify-center text-center">
                  <span className="flex h-14 w-14 items-center justify-center rounded-full bg-[#fff0f1] text-[#df3038]"><Icon name="forum" className="text-[28px]" /></span>
                  <h3 className="mt-4 font-bold text-[#172033]">No conversation activity yet</h3>
                  <p className="mt-1 max-w-xs text-sm text-[#667085]">Call, text, email, and internal notes will appear together here.</p>
                </div>
              )}
            </div>
            <div className="border-t border-[#dfe3e8] bg-[#fbfbfc] p-4">
              <div className="overflow-hidden rounded-lg border border-[#ccd3dc] bg-white">
                <div className="flex border-b border-[#e4e7ec]">
                  {([
                    ['sms', 'Text'],
                    ['email', 'Email'],
                    ['note', 'Internal note'],
                  ] as const).map(([key, label]) => (
                    <button key={key} onClick={() => setComposeMode(key)} className={cn('border-b-2 px-4 py-2.5 text-xs font-bold', composeMode === key ? 'border-[#df3038] text-[#b91c26]' : 'border-transparent text-[#667085]')}>
                      {label}
                    </button>
                  ))}
                </div>
                {composeMode === 'email' ? (
                  <input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} placeholder="Subject" className="w-full border-b border-[#edf0f2] px-4 py-2.5 text-sm outline-none placeholder:text-[#98a2b3]" />
                ) : null}
                <textarea
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  placeholder={composeMode === 'note' ? 'Add context for your team...' : `Write a ${composeMode === 'sms' ? 'text' : 'message'} to ${firstName}...`}
                  className="h-24 w-full resize-none px-4 py-3 text-sm text-[#1f2937] outline-none placeholder:text-[#98a2b3]"
                />
                {sendError ? <p className="px-4 pb-2 text-xs font-semibold text-[#c9232d]">{sendError}</p> : null}
                <div className="flex items-center gap-2 border-t border-[#edf0f2] px-3 py-2.5">
                  <button className="flex items-center gap-1.5 text-xs font-semibold text-[#667085]"><Icon name="attach_file" className="text-[18px]" />Attach</button>
                  <button className="flex items-center gap-1.5 text-xs font-semibold text-[#667085]"><Icon name="bolt" className="text-[18px]" />Templates</button>
                  <button onClick={sendMessage} disabled={sending || !message.trim()} className="ml-auto flex h-9 items-center gap-2 rounded-md bg-[#df3038] px-4 text-sm font-bold text-white hover:bg-[#c9232d] disabled:cursor-not-allowed disabled:bg-[#e3a5a9]">
                    <Icon name={sending ? 'hourglass_empty' : 'send'} className="text-[17px]" />
                    {composeMode === 'note' ? 'Add note' : 'Send'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          <section className="overflow-hidden rounded-xl border border-[#d9dfe6] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.04)]">
            <CardHeader title="Opportunity" icon="paid" />
            <div className="p-5">
              <SectionLabel>Deal stage</SectionLabel>
              <div className="mt-5 flex items-start">
                {STAGES.map((stage, index) => {
                  const complete = index < stageIndex
                  const current = index === stageIndex
                  return (
                    <div key={stage.label} className="relative flex flex-1 flex-col items-center">
                      {index > 0 ? <span className={cn('absolute right-1/2 top-3 h-0.5 w-full', index <= stageIndex ? 'bg-[#df3038]' : 'bg-[#d9dfe6]')} /> : null}
                      <span className={cn('relative z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-[11px] font-bold', complete ? 'border-[#df3038] bg-[#df3038] text-white' : current ? 'border-[#df3038] bg-white text-[#df3038]' : 'border-[#cfd6de] bg-white text-[#98a2b3]')}>
                        {complete ? <Icon name="check" className="text-[14px]" /> : current ? <span className="h-2 w-2 rounded-full bg-[#df3038]" /> : null}
                      </span>
                      <span className={cn('mt-2 text-center text-[10px] font-semibold', current ? 'text-[#b91c26]' : 'text-[#667085]')}>{stage.label}</span>
                    </div>
                  )
                })}
              </div>

              <dl className="mt-7 space-y-4 border-t border-[#e4e7ec] pt-5 text-sm">
                <DataRow label="Motivation score" value={`${score ?? lead.motivation_score ?? '—'}${score != null || lead.motivation_score != null ? ' / 100' : ''}`} accent />
                <DataRow label="Estimated value" value={formatMoney(lead.arv ?? assessedValue)} />
                <DataRow label="Our offer" value={formatMoney(lead.offer_amount)} />
              </dl>

              <div className="my-6 border-t border-[#e4e7ec]" />
              <SectionLabel>Next steps</SectionLabel>
              <div className="mt-3 space-y-2">
                <NextStep label="Call seller" value={lead.phone ? 'Ready now' : 'Phone missing'} onClick={onCall} />
                <NextStep label="Schedule appointment" value={appointment ? 'Scheduled' : 'Not set'} onClick={onAppointment} />
                <NextStep label="Review offer" value={lead.offer_amount ? formatMoney(lead.offer_amount) : 'Not set'} onClick={onContract} />
              </div>

              {appointment ? (
                <button onClick={onAppointment} className="mt-5 flex w-full items-start gap-3 rounded-lg border border-[#efb4b8] bg-[#fff9f9] p-4 text-left hover:bg-[#fff1f2]">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#df3038] text-white"><Icon name="calendar_month" /></span>
                  <span>
                    <span className="block text-xs font-black uppercase tracking-[0.08em] text-[#b91c26]">Appointment scheduled</span>
                    <span className="mt-1 block text-sm font-bold text-[#172033]">{new Date(appointment.scheduledAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="mt-0.5 block text-xs text-[#667085]">{appointment.address || lead.property_address}</span>
                  </span>
                </button>
              ) : (
                <button onClick={onAppointment} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[#efb4b8] px-4 py-4 text-sm font-bold text-[#b91c26] hover:bg-[#fff7f7]">
                  <Icon name="event" />
                  Schedule appointment
                </button>
              )}

              <div className="mt-5 grid grid-cols-2 gap-2">
                <button onClick={onTask} className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#cfd6de] text-xs font-bold text-[#344054] hover:bg-[#f7f8fa]"><Icon name="add_task" />New task</button>
                <button onClick={onEdit} className="flex h-10 items-center justify-center gap-2 rounded-md border border-[#cfd6de] text-xs font-bold text-[#344054] hover:bg-[#f7f8fa]"><Icon name="edit" />More details</button>
              </div>
            </div>
          </section>
        </main>

        <nav className="mt-4 grid grid-cols-3 overflow-hidden rounded-xl border border-[#d9dfe6] bg-white shadow-[0_1px_3px_rgba(16,24,40,0.04)] md:grid-cols-6" aria-label="Lead workspace sections">
          {[
            ['grid_view', 'Overview'],
            ['home_work', 'Property details'],
            ['description', 'Documents'],
            ['auto_awesome', 'AI insights'],
            ['campaign', 'Marketing'],
            ['history', 'Activity log'],
          ].map(([icon, label], index) => (
            <button key={label} onClick={index === 1 ? onOpenProperty : undefined} className={cn('flex h-14 items-center justify-center gap-2 border-b-2 text-xs font-semibold md:text-sm', index === 0 ? 'border-[#df3038] text-[#b91c26]' : 'border-transparent text-[#475467] hover:bg-[#f8f9fa]')}>
              <Icon name={icon} className="text-[18px]" />
              {label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}

function ActionButton({ icon, label, onClick, disabled }: { icon: string; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex h-11 min-w-[104px] items-center justify-center gap-2 rounded-md border border-[#df3038] bg-white px-4 text-sm font-bold text-[#b91c26] hover:bg-[#fff5f5] disabled:cursor-not-allowed disabled:border-[#d5dae0] disabled:text-[#98a2b3]">
      <Icon name={icon} className="text-[19px]" />
      {label}
    </button>
  )
}

function SummaryItem({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-4 border-r border-[#e4e7ec] last:border-r-0 md:px-4 first:pl-0">
      <span className="text-xs font-bold uppercase tracking-[0.08em] text-[#667085]">{label}</span>
      <div className="ml-auto">{children}</div>
    </div>
  )
}

function CardHeader({ title, icon, onMore }: { title: string; icon: string; onMore?: () => void }) {
  return (
    <div className="flex h-13 items-center border-b border-[#dfe3e8] px-5">
      <Icon name={icon} className="mr-2 text-[19px] text-[#df3038]" />
      <h2 className="text-base font-black text-[#172033]">{title}</h2>
      {onMore ? <button onClick={onMore} className="ml-auto text-[#667085] hover:text-[#df3038]"><Icon name="more_vert" /></button> : null}
    </div>
  )
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] font-black uppercase tracking-[0.1em] text-[#3d4e66]">{children}</p>
}

function DataRow({ label, value, accent, compact }: { label: string; value: string; accent?: boolean; compact?: boolean }) {
  return (
    <div className={cn('flex items-start justify-between gap-3', compact && 'flex-col gap-0.5')}>
      <dt className="text-[#667085]">{label}</dt>
      <dd className={cn('min-w-0 break-all text-right font-semibold text-[#1f2937]', accent && 'text-[#b91c26]', compact && 'text-left')}>{value}</dd>
    </div>
  )
}

function TimelineActivity({ activity }: { activity: LeadWorkspaceActivity }) {
  const meta = ACTIVITY_META[activity.activity_type] || { icon: 'timeline', label: activity.activity_type.replace(/_/g, ' '), tone: 'bg-[#f1f3f5] text-[#4b5563]' }
  const direction = directionFor(activity)
  const isOutbound = direction === 'Outbound'
  const isCall = activity.activity_type === 'call'
  const text = activity.description || (isCall ? 'Call activity' : 'No details recorded')
  return (
    <article className="grid grid-cols-[92px_34px_1fr] gap-3">
      <time className="pt-1 text-right text-[11px] leading-4 text-[#667085]">{formatActivityDate(activity.created_at)}</time>
      <div className="relative flex justify-center">
        <span className="absolute bottom-[-22px] top-8 w-px bg-[#e1e5e9]" />
        <span className={cn('relative z-10 flex h-8 w-8 items-center justify-center rounded-full', meta.tone)}><Icon name={meta.icon} className="text-[17px]" /></span>
      </div>
      <div className={cn('rounded-lg border p-3', activity.activity_type === 'note' || activity.activity_type === 'agent_note' ? 'border-[#f1d38d] bg-[#fff9ec]' : isOutbound ? 'border-[#efc1c4] bg-[#fff7f7]' : 'border-[#dce2e8] bg-[#f9fafb]')}>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-black text-[#172033]">{direction ? `${direction} ${meta.label}` : meta.label}</span>
          {activity.agent ? <span className="text-[10px] text-[#667085]">by {toProperCase(activity.agent)}</span> : null}
        </div>
        <p className="mt-1.5 whitespace-pre-wrap text-sm leading-5 text-[#344054]">{text}</p>
        {isCall ? (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-[#e2e6eb] bg-white px-3 py-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#df3038] text-white"><Icon name="play_arrow" className="text-[17px]" /></span>
            <span className="h-5 flex-1 opacity-55" style={{ backgroundImage: 'repeating-linear-gradient(90deg,#9aa4b2 0,#9aa4b2 1px,transparent 1px,transparent 5px)', clipPath: 'polygon(0 45%,5% 20%,10% 65%,15% 35%,20% 75%,25% 25%,30% 60%,35% 15%,40% 70%,45% 35%,50% 80%,55% 25%,60% 60%,65% 40%,70% 75%,75% 20%,80% 65%,85% 35%,90% 70%,95% 25%,100% 50%,100% 55%,0 55%)' }} />
          </div>
        ) : null}
      </div>
    </article>
  )
}

function NextStep({ label, value, onClick }: { label: string; value: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[#f7f8fa]">
      <span className="h-5 w-5 rounded-full border-2 border-[#b9c1cc]" />
      <span className="text-sm font-semibold text-[#344054]">{label}</span>
      <span className="ml-auto text-xs font-medium text-[#b91c26]">{value}</span>
    </button>
  )
}
