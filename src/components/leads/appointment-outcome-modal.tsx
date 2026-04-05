/**
 * Appointment Outcome Modal
 *
 * Surfaces after an appointment's scheduled time passes.
 * Lets Casey record the outcome: completed, no-show, cancelled, rescheduled.
 */

'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

type OutcomeType = 'completed' | 'no_show' | 'cancelled' | 'rescheduled'

interface AppointmentOutcomeModalProps {
  lead: { id: string; full_name: string | null }
  appointment: {
    appointmentId: string
    type: string
    scheduledAt: string
    assignedTo: string
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
    color: 'bg-secondary-container text-secondary',
  },
  {
    type: 'no_show',
    label: 'No-Show',
    icon: 'cancel',
    color: 'bg-error-container text-error',
  },
  {
    type: 'cancelled',
    label: 'Cancelled',
    icon: 'block',
    color: 'bg-surface-variant text-on-surface-variant',
  },
  {
    type: 'rescheduled',
    label: 'Rescheduled',
    icon: 'update',
    color: 'bg-tertiary-container text-tertiary',
  },
]

export function AppointmentOutcomeModal({
  lead,
  appointment,
  onClose,
  onSuccess,
}: AppointmentOutcomeModalProps) {
  const [selectedOutcome, setSelectedOutcome] = useState<OutcomeType | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (!selectedOutcome) return

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
        }),
      })

      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to log outcome')
      }

      onSuccess()
      onClose()
    } catch (err: any) {
      setError(err.message || 'Something went wrong')
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
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-primary/20 backdrop-blur-sm">
      <div
        className="w-full max-w-lg bg-surface-container-lowest rounded-xl shadow-2xl overflow-hidden border border-outline-variant/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-primary tracking-tight mb-1">
                Appointment Outcome
              </h2>
              <p className="text-sm text-on-surface-variant">
                {lead.full_name || 'Unknown'} &mdash; {appointment.type}
              </p>
              <p className="text-xs text-on-surface-variant/70 mt-0.5">
                Scheduled: {formattedDate} &middot; {appointment.assignedTo}
              </p>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-surface-container-high transition-colors"
            >
              <Icon name="close" size="text-lg" className="text-on-surface-variant" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-6">
          {/* Outcome Grid */}
          <div>
            <label className="text-xs font-bold text-primary uppercase tracking-wider mb-3 block">
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
                        ? 'border-primary shadow-md scale-[1.02]'
                        : 'border-outline-variant/20 hover:border-outline-variant/40'
                    }
                  `}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${outcome.color}`}
                    >
                      <Icon name={outcome.icon} size="text-lg" />
                    </div>
                    <p className="text-sm font-bold text-on-surface">
                      {outcome.label}
                    </p>
                    {selectedOutcome === outcome.type && (
                      <div className="absolute top-1.5 right-1.5">
                        <Icon
                          name="check_circle"
                          className="text-primary"
                          size="text-sm"
                        />
                      </div>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Notes (Optional) */}
          <div>
            <label className="text-xs font-bold text-primary uppercase tracking-wider mb-2 block">
              Notes <span className="text-on-surface-variant/60">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any details about the appointment..."
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary/20 bg-surface-container"
            />
          </div>

          {error && (
            <p className="text-sm text-error font-medium">{error}</p>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-container-high border-t border-outline-variant/10 flex items-center justify-between gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:bg-surface-container rounded-lg transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={handleSubmit}
            disabled={!selectedOutcome || submitting}
            className="px-6 py-2.5 bg-primary text-on-primary font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving...' : 'Log Outcome'}
          </button>
        </div>
      </div>
    </div>
  )
}
