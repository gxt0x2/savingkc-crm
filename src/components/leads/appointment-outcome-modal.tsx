/**
 * Appointment Outcome Modal
 *
 * Surfaces after an appointment's scheduled time passes.
 * Lets Casey record the outcome: completed, no-show, cancelled, rescheduled.
 */

'use client'

import { useId, useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { useDialogAccessibility } from '@/hooks/use-dialog-accessibility'
import { DEAD_REASONS } from '@/lib/lead-outcomes'

type OutcomeType = 'completed' | 'no_show' | 'cancelled' | 'rescheduled'
type CompletedNextStep = 'offer_presented' | 'qualified' | 'stay_with_follow_up'

interface AppointmentOutcomeModalProps {
  lead: { id: string; full_name: string | null }
  appointment: {
    appointmentId: string | null
    type: string | null
    scheduledAt: string
    assignedTo: string | null
  }
  onClose: () => void
  onSuccess: () => void
}

const OUTCOMES: Array<{
  type: OutcomeType
  label: string
  icon: string
  color: string
}> = [
  {
    type: 'completed',
    label: 'Completed',
    icon: 'check_circle',
    color: 'bg-[#e9f8ef] text-[#148044]',
  },
  {
    type: 'no_show',
    label: 'No-Show',
    icon: 'cancel',
    color: 'bg-[#fff0f1] text-[#c9232d]',
  },
  {
    type: 'cancelled',
    label: 'Cancelled',
    icon: 'block',
    color: 'bg-[#f1f3f5] text-[#667085]',
  },
  {
    type: 'rescheduled',
    label: 'Rescheduled',
    icon: 'update',
    color: 'bg-[#fff5e5] text-[#9a5800]',
  },
]

export function AppointmentOutcomeModal({
  lead,
  appointment,
  onClose,
  onSuccess,
}: AppointmentOutcomeModalProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeType | null>(null)
  const [completedNextStep, setCompletedNextStep] = useState<CompletedNextStep | null>(null)
  const [notInterested, setNotInterested] = useState(false)
  const [deadReason, setDeadReason] = useState('')
  const [deadReasonNotes, setDeadReasonNotes] = useState('')
  const [followUpTitle, setFollowUpTitle] = useState('')
  const [followUpDue, setFollowUpDue] = useState('')
  const [newAppointmentAt, setNewAppointmentAt] = useState('')
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const titleId = useId()
  const notesId = useId()
  const dialogRef = useDialogAccessibility<HTMLDivElement>(true, onClose)
  const stayHere = selectedOutcome === 'completed' && completedNextStep === 'stay_with_follow_up'
  const needsDeadReason = selectedOutcome === 'cancelled' && notInterested
  const canSubmit = Boolean(selectedOutcome)
    && (selectedOutcome !== 'completed' || completedNextStep)
    && (!stayHere || (followUpTitle.trim() && followUpDue))
    && (!needsDeadReason || deadReason)
    && (!(needsDeadReason && deadReason === 'other') || deadReasonNotes.trim() || notes.trim())

  async function handleSubmit() {
    if (!selectedOutcome || !canSubmit) return

    setSubmitting(true)
    setError(null)

    try {
      const res = await fetch('/api/leads/appointment-outcome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          appointmentId: appointment.appointmentId,
          outcome: selectedOutcome,
          notes,
          completedNextStep: selectedOutcome === 'completed' ? completedNextStep : null,
          notInterested: needsDeadReason,
          deadReason: needsDeadReason ? deadReason : null,
          deadReasonNotes: needsDeadReason ? deadReasonNotes : null,
          followUp: stayHere ? {
            title: followUpTitle.trim(),
            notes: null,
            dueAt: new Date(followUpDue).toISOString(),
          } : null,
          replacementAppointment: selectedOutcome === 'rescheduled' && newAppointmentAt
            ? { scheduledAt: new Date(newAppointmentAt).toISOString() }
            : null,
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to log outcome')
      }

      onSuccess()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setSubmitting(false)
    }
  }

  const scheduledDate = new Date(appointment.scheduledAt)
  const formattedDate = scheduledDate.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#111827]/55 p-4 backdrop-blur-sm">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[#d9dfe6] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[#e4e7ec] px-6 pb-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 id={titleId} className="mb-1 text-xl font-black tracking-tight text-[#111827]">
                Appointment Outcome
              </h2>
              <p className="text-sm text-[#475467]">
                {lead.full_name || 'Unknown'} &mdash; {appointment.type}
              </p>
              <p className="mt-0.5 text-xs text-[#667085]">
                Scheduled: {formattedDate} &middot; {appointment.assignedTo}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close appointment outcome dialog"
              className="rounded-lg p-1.5 transition-colors hover:bg-[#f2f4f7]"
            >
              <Icon name="close" size="text-lg" className="text-[#667085]" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-6">
          {/* Outcome Grid */}
          <div>
            <label className="mb-3 block text-xs font-bold uppercase tracking-wider text-[#344054]">
              What happened?
            </label>
            <div className="grid grid-cols-2 gap-3">
              {OUTCOMES.map((outcome) => (
                <button
                  key={outcome.type}
                  onClick={() => setSelectedOutcome(outcome.type)}
                  className={`
                    relative p-4 rounded-lg border-2 transition-all text-left
                    ${
                      selectedOutcome === outcome.type
                        ? 'scale-[1.02] border-[#df3038] bg-[#fff8f8] shadow-md'
                        : 'border-[#d9dfe6] hover:border-[#efb4b8]'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${outcome.color}`}
                    >
                      <Icon name={outcome.icon} size="text-lg" />
                    </div>
                    <p className="text-sm font-bold text-[#172033]">
                      {outcome.label}
                    </p>
                    {selectedOutcome === outcome.type && (
                      <div className="absolute top-1.5 right-1.5">
                        <Icon
                          name="check_circle"
                          className="text-[#df3038]"
                          size="text-sm"
                        />
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {selectedOutcome === 'completed' && (
            <fieldset className="space-y-2">
              <legend className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#344054]">What happened next?</legend>
              {([
                ['offer_presented', 'Offer presented — move to Offer'],
                ['qualified', 'No offer — move to Qualified'],
                ['stay_with_follow_up', 'Stay here and schedule a follow-up'],
              ] as const).map(([value, label]) => (
                <label key={value} className="flex items-center gap-2 text-sm text-[#172033]">
                  <input type="radio" name="completed-next-step" value={value} checked={completedNextStep === value} onChange={() => setCompletedNextStep(value)} />
                  {label}
                </label>
              ))}
            </fieldset>
          )}

          {stayHere && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold uppercase tracking-wider text-[#344054]">
                Follow-up
                <input value={followUpTitle} onChange={(event) => setFollowUpTitle(event.target.value)} placeholder="What needs to happen" className="mt-2 w-full rounded-lg border border-[#cfd6de] px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#1f2937]" />
              </label>
              <label className="text-xs font-bold uppercase tracking-wider text-[#344054]">
                Due
                <input type="datetime-local" value={followUpDue} onChange={(event) => setFollowUpDue(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cfd6de] px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#1f2937]" />
              </label>
            </div>
          )}

          {selectedOutcome === 'no_show' && (
            <p className="text-sm text-[#475467]">The lead moves to Qualified, or Contacted if they were never qualified, and a follow-up task is created.</p>
          )}

          {selectedOutcome === 'cancelled' && (
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-[#172033]">
                <input type="checkbox" checked={notInterested} onChange={(event) => setNotInterested(event.target.checked)} />
                Seller is not interested
              </label>
              {needsDeadReason && (
                <label className="block text-xs font-bold uppercase tracking-wider text-[#344054]">
                  Dead reason
                  <select value={deadReason} onChange={(event) => setDeadReason(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cfd6de] px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#1f2937]">
                    <option value="">Choose a reason</option>
                    {DEAD_REASONS.map((reason) => <option key={reason.id} value={reason.id}>{reason.label}</option>)}
                  </select>
                </label>
              )}
              {needsDeadReason && deadReason === 'other' && (
                <label className="block text-xs font-bold uppercase tracking-wider text-[#344054]">
                  Reason notes
                  <input value={deadReasonNotes} onChange={(event) => setDeadReasonNotes(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cfd6de] px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#1f2937]" />
                </label>
              )}
              {!notInterested && <p className="text-sm text-[#475467]">The lead moves to Qualified and a follow-up task is created.</p>}
            </div>
          )}

          {selectedOutcome === 'rescheduled' && (
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-[#344054]">
                New appointment time
                <input type="datetime-local" value={newAppointmentAt} onChange={(event) => setNewAppointmentAt(event.target.value)} className="mt-2 w-full rounded-lg border border-[#cfd6de] px-3 py-2 text-sm font-medium normal-case tracking-normal text-[#1f2937]" />
              </label>
              <p className="text-sm text-[#475467]">Leave this blank to move the lead to Qualified and create a reschedule task. A future time keeps the lead at Appointment set.</p>
            </div>
          )}

          {/* Notes (Optional) */}
          <div>
            <label htmlFor={notesId} className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#344054]">
              Notes <span className="text-[#98a2b3]">(optional)</span>
            </label>
            <textarea
              id={notesId}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any details about the appointment..."
              className="min-h-[80px] w-full rounded-lg border border-[#cfd6de] bg-white px-3 py-2 text-sm text-[#1f2937] focus:border-[#df3038] focus:outline-none focus:ring-2 focus:ring-[#df3038]/10"
            />
          </div>

          {error && (
            <p className="text-sm font-medium text-[#c9232d]">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-4 border-t border-[#e4e7ec] bg-[#f8f9fa] px-6 py-4">
          <button
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm font-medium text-[#475467] transition-colors hover:bg-white"
          >
            Skip for now
          </button>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="rounded-lg bg-[#df3038] px-6 py-2.5 font-bold text-white transition-all hover:bg-[#c9232d] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Saving...' : 'Log Outcome'}
          </button>
        </div>
      </div>
    </div>
  )
}
