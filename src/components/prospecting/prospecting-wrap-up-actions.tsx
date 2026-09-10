'use client'

import dynamic from 'next/dynamic'
import { useMemo, useRef, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import type { DialerActivity } from '@/lib/dialer-lead-activity'
import { withDialerSessionControlOperation } from '@/lib/telephony/dialer-control-operation-client'

const NewTaskModal = dynamic(() => import('@/components/modals/new-task-modal').then((module) => module.NewTaskModal))
const ProspectingMailModal = dynamic(() => import('@/components/prospecting/prospecting-mail-modal').then((module) => module.ProspectingMailModal))

interface ProspectingWrapUpActionsProps {
  leadId: string | null
  prospectId: string | null
  campaignMemberId: string | null
  dialerSessionId: string
  sellerName: string
  propertyAddress: string
  activities: DialerActivity[]
  readOnly: boolean
  onRefresh: () => void
}

type TaskChoice = 'follow_up' | 'appointment'

function activityText(activity: DialerActivity): { title: string; detail: string } {
  const title = typeof activity.metadata?.title === 'string' && activity.metadata.title.trim()
    ? activity.metadata.title.trim()
    : activity.description || 'Next action'
  const status = typeof activity.metadata?.status === 'string' ? activity.metadata.status : 'pending'
  const dueValue = typeof activity.metadata?.due_date === 'string' ? activity.metadata.due_date : null
  const dueDate = dueValue ? new Date(dueValue) : null
  const due = dueDate && !Number.isNaN(dueDate.getTime())
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/Chicago' }).format(dueDate)
    : 'No due date'
  return { title, detail: `${status === 'completed' ? 'Done' : 'Open'} · ${due}` }
}

export function ProspectingWrapUpActions(props: ProspectingWrapUpActionsProps) {
  const [taskChoice, setTaskChoice] = useState<TaskChoice | null>(null)
  const [mailOpen, setMailOpen] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const [savingMail, setSavingMail] = useState<string | null>(null)
  const [mailError, setMailError] = useState('')
  const mailRequestKeys = useRef(new Map<string, string>())
  const recentWork = useMemo(() => props.activities.filter((activity) => (
    ['task', 'appointment', 'follow_up', 'callback', 'mail'].includes(activity.activity_type)
  )).slice(0, 3), [props.activities])

  async function markMailSent(activity: DialerActivity) {
    if (props.readOnly || savingMail) return
    setSavingMail(activity.id)
    setMailError('')
    if (!mailRequestKeys.current.has(activity.id)) mailRequestKeys.current.set(activity.id, crypto.randomUUID())
    try {
      const response = await withDialerSessionControlOperation(props.dialerSessionId, 'Marking mail sent', (headers, signal) => fetch('/api/prospecting/mail-actions', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': mailRequestKeys.current.get(activity.id)!, ...headers },
        body: JSON.stringify({ leadId: props.leadId, prospectId: props.prospectId, campaignMemberId: props.campaignMemberId, dialerSessionId: props.dialerSessionId || null, workItemKey: `activity:${activity.id}`, pieceType: activity.metadata?.mail_piece_type || 'thank_you', mailState: 'sent' }),
      }))
      const body = await response.json()
      if (!response.ok) throw new Error(body.error || 'Mail status could not be saved')
      mailRequestKeys.current.delete(activity.id)
      created('Mail marked sent.')
    } catch (error) {
      setMailError(error instanceof Error ? error.message : 'Mail status could not be saved')
    } finally { setSavingMail(null) }
  }

  function created(message: string) {
    setTaskChoice(null)
    setMailOpen(false)
    setAnnouncement(message)
    props.onRefresh()
  }

  const subjectProps = {
    leadId: props.leadId || undefined,
    prospectId: props.prospectId || undefined,
    campaignMemberId: props.campaignMemberId || undefined,
    dialerSessionId: props.dialerSessionId || undefined,
    leadName: props.sellerName,
  }

  return <>
    <section aria-label="Wrap-up and next actions" className="ck-card p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div><p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Wrap-up</p><h2 className="mt-0.5 text-sm font-black text-[var(--ck-text)]">What happens next?</h2></div>
        <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${props.leadId ? 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]' : 'border-amber-400/30 bg-amber-400/10 text-amber-500'}`}>{props.leadId ? 'Lead' : 'Source Prospect'}</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <button type="button" disabled={props.readOnly} onClick={() => setTaskChoice('follow_up')} className="min-h-[68px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-45"><Icon name="event_repeat" size="text-lg" className="mx-auto mb-1 text-[var(--crm-brand)]" />Follow-up</button>
        <button type="button" disabled={props.readOnly} onClick={() => setTaskChoice('appointment')} className="min-h-[68px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-45"><Icon name="calendar_month" size="text-lg" className="mx-auto mb-1 text-[var(--crm-brand)]" />Appointment</button>
        <button type="button" disabled={props.readOnly} onClick={() => setMailOpen(true)} className="min-h-[68px] rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] px-2 py-2 text-center text-[10px] font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-45"><Icon name="mail" size="text-lg" className="mx-auto mb-1 text-[var(--crm-brand)]" />Mail</button>
      </div>
      {props.readOnly ? <p className="mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2 text-[10px] leading-4 text-[var(--ck-text-muted)]">Next actions are visible but locked until this window owns the live dialing session.</p> : null}
      {recentWork.length > 0 ? <div className="mt-3 border-t border-[var(--ck-border)] pt-3"><p className="mb-2 text-[9px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Recent work</p><div className="space-y-1.5">{recentWork.map((activity) => { const item = activityText(activity); return <div key={activity.id} className="rounded-lg bg-[var(--ck-surface-elev)] px-3 py-2"><p className="truncate text-xs font-bold text-[var(--ck-text)]">{item.title}</p><p className="mt-0.5 text-[9px] uppercase tracking-wider text-[var(--ck-text-dim)]">{item.detail}</p></div> })}</div></div> : null}
      {recentWork.filter((activity) => activity.activity_type === 'mail' && activity.metadata?.status !== 'completed').map((activity) => <button key={`sent:${activity.id}`} type="button" disabled={props.readOnly || Boolean(savingMail)} onClick={() => { void markMailSent(activity) }} className="crm-secondary-button mt-2 min-h-10 w-full rounded-lg px-3 py-2 text-xs font-bold disabled:opacity-45">{savingMail === activity.id ? 'Saving…' : `Mark sent: ${activityText(activity).title}`}</button>)}
      {mailError ? <p role="alert" className="mt-2 text-xs text-[var(--crm-danger)]">{mailError}</p> : null}
      <p aria-live="polite" className="mt-2 min-h-4 text-[10px] font-bold text-emerald-500">{announcement}</p>
    </section>

    {taskChoice ? <NewTaskModal
      {...subjectProps}
      initialTaskType={taskChoice}
      initialTitle={`${taskChoice === 'appointment' ? 'Appointment with' : 'Follow up with'} ${props.sellerName || 'seller'}`}
      primaryNextAction={Boolean(props.leadId)}
      onClose={() => setTaskChoice(null)}
      onCreated={() => created(taskChoice === 'appointment' ? 'Appointment added.' : 'Follow-up added.')}
    /> : null}
    {mailOpen ? <ProspectingMailModal
      leadId={props.leadId}
      prospectId={props.prospectId}
      campaignMemberId={props.campaignMemberId}
      dialerSessionId={props.dialerSessionId}
      sellerName={props.sellerName}
      propertyAddress={props.propertyAddress}
      onClose={() => setMailOpen(false)}
      onCreated={created}
    /> : null}
  </>
}
