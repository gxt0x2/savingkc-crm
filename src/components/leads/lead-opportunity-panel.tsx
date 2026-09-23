'use client'

import { cn } from '@/lib/utils'
import { DeleteAppointmentButton } from '@/components/leads/delete-appointment-button'
import { GovernedNextAction, type LeadNextActionTask } from '@/components/leads/governed-next-action'
import { FavoriteOrFoolSignal } from '@/components/leads/favorite-or-fool-signal'
import { LeadQualificationPanel } from '@/components/leads/lead-qualification-panel'
import {
  LEAD_WORKSPACE_STAGES,
  resolveLeadWorkspaceStage,
} from '@/lib/lead-stage'

export { LEAD_WORKSPACE_STAGES } from '@/lib/lead-stage'

interface LeadOpportunityPanelProps {
  leadId: string
  nextActionTask: LeadNextActionTask | null
  station: string | null
  source?: string | null
  notes?: string | null
  sellerSituation?: string | null
  isFavorite?: boolean | null
  activities: Array<{
    activity_type: string
    description: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }>
  score: number | null
  motivationScore: number | null
  estimatedValue: number | null
  offerAmount: number | null
  offerMethod: 'Verbal' | 'Written' | null
  phoneAvailable: boolean
  propertyAddress: string | null
  appointment: { scheduledAt: string; address?: string | null; appointmentId?: string | null } | null
  appointmentIsPast: boolean
  onCall: () => void
  onAppointment: () => void
  onAppointmentOutcome: () => void
  onAppointmentDeleted?: () => void
  onOffer: () => void
  onContract: () => void
  onTask: () => void
  onEdit: () => void
}

function money(value: number | null) {
  return value == null ? '—' : `$${Math.round(value).toLocaleString()}`
}

export function LeadOpportunityPanel({
  leadId,
  nextActionTask,
  station,
  source,
  notes,
  sellerSituation,
  isFavorite,
  activities,
  score,
  motivationScore,
  estimatedValue,
  offerAmount,
  offerMethod,
  phoneAvailable,
  propertyAddress,
  appointment,
  appointmentIsPast,
  onCall,
  onAppointment,
  onAppointmentOutcome,
  onAppointmentDeleted,
  onOffer,
  onContract,
  onTask,
  onEdit,
}: LeadOpportunityPanelProps) {
  const stage = resolveLeadWorkspaceStage(station, Boolean(appointment))
  const stageIndex = stage.index
  const offerSummary = offerAmount ? `${offerMethod ? `${offerMethod} · ` : ''}${money(offerAmount)}` : 'Verbal or written'

  return (
    <section className="crm-panel flex min-h-[24rem] flex-col overflow-hidden rounded-xl xl:h-[calc(100vh-300px)] xl:min-h-[560px] xl:max-h-[820px]">
      <div className="flex h-13 items-center border-b border-[var(--crm-border)] px-5">
        <span aria-hidden="true" className="mr-2 flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--crm-violet-soft)] text-sm font-black text-[var(--crm-violet)]">$</span>
        <h2 className="text-base font-bold text-[var(--crm-ink)]">Opportunity</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-5">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--crm-text-muted)]">Deal stage</p>
          <p className="text-[10px] font-black text-[var(--crm-success)]">Current: {stage.label}</p>
        </div>
        <ol className="mt-5 flex items-start" aria-label="Deal stage progression">
          {LEAD_WORKSPACE_STAGES.map((stage, index) => {
            const complete = index < stageIndex
            const current = index === stageIndex
            return (
              <li key={stage.label} className="relative flex min-w-0 flex-1 flex-col items-center" aria-current={current ? 'step' : undefined}>
                {index > 0 ? <span className={cn('absolute right-1/2 top-2.5 h-0.5 w-full', index <= stageIndex ? 'bg-[var(--crm-success)]' : 'bg-[var(--crm-border)]')} /> : null}
                <span className={cn('relative z-10 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 text-[9px] font-black', complete ? 'border-[var(--crm-success)] bg-[var(--crm-success)] text-white' : current ? 'border-[var(--crm-success)] bg-[var(--crm-success-soft)] text-[var(--crm-success)]' : 'border-[var(--crm-border-strong)] bg-[var(--crm-surface)] text-transparent')}>
                  {complete ? '✓' : current ? '•' : ''}
                </span>
                <span className={cn('mt-1.5 px-0.5 text-center text-[9px] font-bold leading-3 tracking-tight', current ? 'text-[var(--crm-success)]' : 'text-[var(--crm-text-muted)]')}>{stage.label}</span>
              </li>
            )
          })}
        </ol>

        {stage.appointmentDerived ? (
          <p className="mt-2 text-center text-[10px] font-bold text-[var(--crm-success)]">Synced from the scheduled appointment</p>
        ) : null}

        {stageIndex < 0 ? (
          <p role="status" className="mt-3 rounded-lg bg-[var(--crm-brand-soft)] px-3 py-2 text-[11px] font-bold text-[var(--crm-brand)]">
            This saved stage is not part of the current pipeline. Review the stage before advancing the lead.
          </p>
        ) : null}

        <FavoriteOrFoolSignal
          className="mt-5"
          leadId={leadId}
          source={source}
          notes={notes}
          sellerSituation={sellerSituation}
          isFavorite={isFavorite}
          motivationScore={motivationScore}
          appointment={appointment}
          activities={activities}
        />

        <LeadQualificationPanel leadId={leadId} />

        <dl className="mt-7 space-y-4 border-t border-[var(--crm-border)] pt-5 text-sm">
          <DataRow label="Motivation score" value={`${score ?? motivationScore ?? '—'}${score != null || motivationScore != null ? ' / 100' : ''}`} accent />
          <DataRow label="Estimated value" value={money(estimatedValue)} />
        </dl>

        <div className="mt-5">
          <GovernedNextAction
            key={leadId}
            leadId={leadId}
            task={nextActionTask}
            appointment={appointment}
            appointmentIsPast={appointmentIsPast}
            onAppointment={onAppointment}
            onAppointmentOutcome={onAppointmentOutcome}
          />
        </div>

        <button
          type="button"
          onClick={onOffer}
          className="mt-5 flex w-full items-center gap-3 rounded-xl border border-[var(--crm-info)]/30 bg-[var(--crm-info-soft)] p-3 text-left transition-colors hover:brightness-95"
          aria-label={offerAmount ? `Update ${offerMethod ? `${offerMethod.toLowerCase()} ` : ''}offer of ${money(offerAmount)}` : 'Record a verbal or written offer'}
        >
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--crm-surface)] text-lg font-black text-[var(--crm-info)]">$</span>
          <span className="min-w-0 flex-1">
            <span className="block text-[10px] font-black uppercase tracking-[0.08em] text-[var(--crm-info)]">Our offer</span>
            <span className="mt-0.5 block text-lg font-black text-[var(--crm-ink)]">{money(offerAmount)}</span>
            <span className="block text-[11px] text-[var(--crm-text-muted)]">{offerAmount ? `${offerMethod ? `${offerMethod} · ` : ''}Click to update` : 'Record verbal or written'}</span>
          </span>
          <span className="text-[11px] font-black text-[var(--crm-info)]">Update</span>
        </button>

        <div className="my-6 border-t border-[var(--crm-border)]" />
        <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[var(--crm-text-muted)]">Next steps</p>
        <div className="mt-3 space-y-2">
          <NextStep label="Call seller" value={phoneAvailable ? 'Ready now' : 'Phone missing'} onClick={onCall} disabled={!phoneAvailable} />
          <NextStep
            label={appointmentIsPast ? 'Record appointment outcome' : 'Schedule appointment'}
            value={appointmentIsPast ? 'Required' : appointment ? 'Scheduled' : 'Not set'}
            onClick={appointmentIsPast ? onAppointmentOutcome : onAppointment}
          />
          <NextStep label={offerAmount ? 'Update offer' : 'Record offer'} value={offerSummary} onClick={onOffer} />
        </div>

        {appointment ? (
          <div className="mt-5 rounded-lg border border-[var(--crm-border-strong)] bg-[var(--crm-violet-soft)] p-4">
            <button type="button" onClick={appointmentIsPast ? onAppointmentOutcome : onAppointment} className="flex w-full items-start gap-3 text-left hover:brightness-95">
              <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--crm-violet)] text-xs font-black text-white">APPT</span>
              <span>
                <span className="block text-xs font-black uppercase tracking-[0.08em] text-[var(--crm-violet)]">{appointmentIsPast ? 'Appointment outcome required' : 'Appointment scheduled'}</span>
                <span className="mt-1 block text-sm font-bold text-[var(--crm-ink)]">{new Date(appointment.scheduledAt).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                <span className="mt-0.5 block text-xs text-[var(--crm-text-muted)]">{appointment.address || propertyAddress}</span>
              </span>
            </button>
            {onAppointmentDeleted ? (
              <DeleteAppointmentButton
                leadId={leadId}
                appointmentId={appointment.appointmentId}
                scheduledAt={appointment.scheduledAt}
                onDeleted={onAppointmentDeleted}
                className="mt-3 text-xs font-bold text-[var(--crm-danger)] underline-offset-2 hover:underline"
              />
            ) : null}
          </div>
        ) : (
          <button type="button" onClick={onAppointment} className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--crm-brand-border)] px-4 py-4 text-sm font-bold text-[var(--crm-brand)] hover:bg-[var(--crm-brand-soft)]">
            Schedule appointment
          </button>
        )}

        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="button" onClick={onTask} className="crm-secondary-button flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-bold">New task</button>
          <button type="button" onClick={onEdit} className="crm-secondary-button flex h-10 items-center justify-center gap-2 rounded-lg text-xs font-bold">More details</button>
        </div>
        {offerAmount ? (
          <button type="button" onClick={onContract} className="crm-primary-button mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-lg text-xs font-bold">Create contract</button>
        ) : null}
      </div>
    </section>
  )
}

function DataRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="text-[var(--crm-text-muted)]">{label}</dt>
      <dd className={cn('min-w-0 break-all text-right font-semibold text-[var(--crm-text)]', accent && 'text-[var(--crm-info)]')}>{value}</dd>
    </div>
  )
}

function NextStep({ label, value, onClick, disabled }: { label: string; value: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-disabled={disabled} className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-[var(--crm-surface-subtle)] disabled:cursor-not-allowed disabled:opacity-55">
      <span className="h-5 w-5 rounded-full border-2 border-[var(--crm-border-strong)]" />
      <span className="text-sm font-semibold text-[var(--crm-text)]">{label}</span>
      <span className="ml-auto text-xs font-bold text-[var(--crm-brand)]">{value}</span>
    </button>
  )
}
