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
        className="w-full max-w-lg overflow-hidden rounded-xl border border-[#d9dfe6] bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="border-b border-[#e4e7ec] px-6 pb-4 pt-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="mb-1 text-xl font-black tracking-tight text-[#111827]">
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
              onClick={onClose}
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

          {/* Notes (Optional) */}
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-wider text-[#344054]">
              Notes <span className="text-[#98a2b3]">(optional)</span>
            </label>
            <textarea
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
            disabled={!selectedOutcome || submitting}
            className="rounded-lg bg-[#df3038] px-6 py-2.5 font-bold text-white transition-all hover:bg-[#c9232d] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {submitting ? 'Saving...' : 'Log Outcome'}
          </button>
        </div>
      </div>
    </div>
  )
}
