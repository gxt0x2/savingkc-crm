'use client'

import dynamic from 'next/dynamic'
import { useMemo, useState } from 'react'

import { Icon } from '@/components/ui/icon'
import type { DialerActivity } from '@/lib/dialer-lead-activity'

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
  variant?: 'panel' | 'toolbar' | 'tab'
  action?: ProspectingWrapUpAction
  onRefresh: () => void
}

type TaskChoice = 'follow_up' | 'appointment'
export type ProspectingWrapUpAction = TaskChoice | 'mail'

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
  const recentWork = useMemo(() => props.activities.filter((activity) => (
    ['task', 'appointment', 'follow_up', 'callback', 'mail'].includes(activity.activity_type)
    && (!props.action || (props.action === 'mail'
      ? activity.activity_type === 'mail'
      : props.action === 'appointment'
        ? activity.activity_type === 'appointment'
        : ['task', 'follow_up', 'callback'].includes(activity.activity_type)))
  )).slice(0, 3), [props.action, props.activities])
  const toolbar = props.variant === 'toolbar'
  const tab = props.variant === 'tab'
  const availableActions: ProspectingWrapUpAction[] = props.action
    ? [props.action]
    : ['follow_up', 'appointment', 'mail']

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
    <section aria-label="Wrap-up and next actions" className={toolbar || tab ? 'min-w-0' : 'ck-card p-4'}>
      <div className={`${toolbar ? 'mb-2' : 'mb-3'} flex items-start justify-between gap-3`}>
        <div><p className="text-[10px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">{tab ? 'Auto-linked next action' : 'Next move'}</p><h2 className={`${toolbar ? 'mt-0.5 text-xs' : 'mt-0.5 text-sm'} font-black text-[var(--ck-text)]`}>{tab ? props.action === 'appointment' ? 'Schedule this conversation' : props.action === 'mail' ? 'Create physical outreach' : 'Set the next follow-up' : toolbar ? 'Capture the commitment while it is fresh' : 'What happens next?'}</h2></div>
        <span className={`rounded-full border px-2 py-1 text-[9px] font-black uppercase tracking-wider ${props.leadId ? 'border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] text-[var(--crm-info)]' : 'border-amber-400/30 bg-amber-400/10 text-amber-500'}`}>{props.leadId ? 'Lead' : 'Source Prospect'}</span>
      </div>
      {tab ? <p className="mb-3 flex items-center gap-1.5 rounded-lg border border-[var(--crm-info-border)] bg-[var(--crm-info-soft)] px-3 py-2 text-[10px] font-bold text-[var(--ck-text-muted)]"><Icon name="link" size="text-sm" className="text-[var(--crm-info)]" />Attached to the current record · {props.sellerName}</p> : null}
      <div className={`grid gap-2 ${tab ? 'grid-cols-1' : 'grid-cols-3'}`}>
        {availableActions.includes('follow_up') ? <button type="button" disabled={props.readOnly} onClick={() => setTaskChoice('follow_up')} className={`${toolbar ? 'min-h-11 px-2 py-2' : tab ? 'min-h-11 px-4 py-2' : 'min-h-[68px] px-2 py-2 text-center'} rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[10px] font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-45`}><Icon name="event_repeat" size={toolbar ? 'text-base' : 'text-lg'} className={toolbar || tab ? 'mr-1.5 inline text-[var(--crm-brand)]' : 'mx-auto mb-1 text-[var(--crm-brand)]'} />{tab ? 'Add follow-up' : 'Follow-up'}</button> : null}
        {availableActions.includes('appointment') ? <button type="button" disabled={props.readOnly} onClick={() => setTaskChoice('appointment')} className={`${toolbar ? 'min-h-11 px-2 py-2' : tab ? 'min-h-11 px-4 py-2' : 'min-h-[68px] px-2 py-2 text-center'} rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[10px] font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-45`}><Icon name="calendar_month" size={toolbar ? 'text-base' : 'text-lg'} className={toolbar || tab ? 'mr-1.5 inline text-[var(--crm-brand)]' : 'mx-auto mb-1 text-[var(--crm-brand)]'} />{tab ? 'Add appointment' : 'Appointment'}</button> : null}
        {availableActions.includes('mail') ? <button type="button" disabled={props.readOnly} onClick={() => setMailOpen(true)} className={`${toolbar ? 'min-h-11 px-2 py-2' : tab ? 'min-h-11 px-4 py-2' : 'min-h-[68px] px-2 py-2 text-center'} rounded-xl border border-[var(--ck-border)] bg-[var(--ck-surface-elev)] text-[10px] font-black uppercase tracking-wider text-[var(--ck-text)] transition-colors hover:border-[var(--crm-brand)] disabled:cursor-not-allowed disabled:opacity-45`}><Icon name="mail" size={toolbar ? 'text-base' : 'text-lg'} className={toolbar || tab ? 'mr-1.5 inline text-[var(--crm-brand)]' : 'mx-auto mb-1 text-[var(--crm-brand)]'} />{tab ? 'Add mail work' : 'Mail'}</button> : null}
      </div>
      {props.readOnly ? <p className={`${toolbar ? 'mt-2' : 'mt-3 rounded-lg border border-amber-400/25 bg-amber-400/10 px-3 py-2'} text-[10px] leading-4 text-[var(--ck-text-muted)]`}>Next actions are visible but locked until this window owns the live dialing session.</p> : null}
      {!toolbar && recentWork.length > 0 ? <div className="mt-3 border-t border-[var(--ck-border)] pt-3"><p className="mb-2 text-[9px] font-black uppercase tracking-widest text-[var(--ck-text-dim)]">Recent work</p><div className="space-y-1.5">{recentWork.map((activity) => { const item = activityText(activity); return <div key={activity.id} className="rounded-lg bg-[var(--ck-surface-elev)] px-3 py-2"><p className="truncate text-xs font-bold text-[var(--ck-text)]">{item.title}</p><p className="mt-0.5 text-[9px] uppercase tracking-wider text-[var(--ck-text-dim)]">{item.detail}</p></div> })}</div></div> : null}
      {toolbar && recentWork.length > 0 ? <p className="mt-2 truncate text-[10px] font-bold text-[var(--ck-text-muted)]">Latest: {activityText(recentWork[0]).title} · {activityText(recentWork[0]).detail}</p> : null}
      <p aria-live="polite" className={`${toolbar && !announcement ? 'sr-only' : 'mt-2 min-h-4'} text-[10px] font-bold text-emerald-500`}>{announcement}</p>
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
