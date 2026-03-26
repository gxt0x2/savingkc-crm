/**
 * ARI CRM - Disposition Modal
 * Night 3: DSP-01
 *
 * Enforces disposition logging after every completed call
 */

'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

export type DispositionType =
  | 'no_answer'
  | 'left_vm'
  | 'callback_requested'
  | 'spoke_with_owner'
  | 'not_interested'
  | 'wrong_number'
  | 'disconnected'
  | 'dnc'
  | 'deal_potential'
  | 'appointment_set'
  | 'offer_made'
  | 'dead'

interface DispositionModalProps {
  open: boolean
  onClose: () => void
  onDisposition: (disposition: DispositionType, notes?: string) => void
  phoneNumber?: string
  leadName?: string
}

const DISPOSITIONS: Array<{
  type: DispositionType
  label: string
  icon: string
  color: string
}> = [
  {
    type: 'spoke_with_owner',
    label: 'Spoke with Owner',
    icon: 'check_circle',
    color: 'bg-secondary-container text-secondary',
  },
  {
    type: 'no_answer',
    label: 'No Answer',
    icon: 'phone_missed',
    color: 'bg-tertiary-container text-tertiary',
  },
  {
    type: 'left_vm',
    label: 'Left Voicemail',
    icon: 'voicemail',
    color: 'bg-primary-container text-primary',
  },
  {
    type: 'callback_requested',
    label: 'Callback Requested',
    icon: 'call_back',
    color: 'bg-secondary-container text-secondary',
  },
  {
    type: 'deal_potential',
    label: 'Deal Potential',
    icon: 'star',
    color: 'bg-tertiary-fixed text-on-tertiary-fixed',
  },
  {
    type: 'appointment_set',
    label: 'Appointment Set',
    icon: 'event',
    color: 'bg-secondary-fixed text-on-secondary-fixed',
  },
  {
    type: 'not_interested',
    label: 'Not Interested',
    icon: 'cancel',
    color: 'bg-surface-variant text-on-surface-variant',
  },
  {
    type: 'wrong_number',
    label: 'Wrong Number',
    icon: 'error',
    color: 'bg-error-container text-error',
  },
  {
    type: 'disconnected',
    label: 'Disconnected',
    icon: 'phone_disabled',
    color: 'bg-surface-variant text-on-surface-variant',
  },
  {
    type: 'dnc',
    label: 'Do Not Call',
    icon: 'block',
    color: 'bg-error-container text-error',
  },
]

export function DispositionModal({
  open,
  onClose,
  onDisposition,
  phoneNumber,
  leadName,
}: DispositionModalProps) {
  const [selectedDisposition, setSelectedDisposition] =
    useState<DispositionType | null>(null)
  const [notes, setNotes] = useState('')
  const [submitting, setSubmitting] = useState(false)

  if (!open) return null

  async function handleSubmit() {
    if (!selectedDisposition) return

    setSubmitting(true)
    onDisposition(selectedDisposition, notes || undefined)

    // Reset and close
    setTimeout(() => {
      setSelectedDisposition(null)
      setNotes('')
      setSubmitting(false)
      onClose()
    }, 300)
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-primary/20 backdrop-blur-sm">
      <div
        className="w-full max-w-2xl bg-surface-container-lowest rounded-xl shadow-2xl overflow-hidden border border-outline-variant/20"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-4 border-b border-outline-variant/10">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-black text-primary tracking-tight mb-1">
                Log Call Outcome
              </h2>
              <p className="text-sm text-on-surface-variant">
                {leadName || phoneNumber || 'Call completed'} — what was the outcome?
              </p>
            </div>
            <div className="text-error text-xs font-bold uppercase">Required</div>
          </div>
        </div>

        {/* Body */}
        <div className="px-6 py-6 space-y-6">
          {/* Disposition Grid */}
          <div>
            <label className="text-xs font-bold text-primary uppercase tracking-wider mb-3 block">
              Select Disposition
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {DISPOSITIONS.map((disp) => (
                <button
                  key={disp.type}
                  onClick={() => setSelectedDisposition(disp.type)}
                  className={`
                    relative p-3 rounded-lg border-2 transition-all text-left
                    ${
                      selectedDisposition === disp.type
                        ? 'border-primary shadow-md scale-[1.02]'
                        : 'border-outline-variant/20 hover:border-outline-variant/40'
                    }
                  `}
                >
                  <div className="flex items-start gap-2">
                    <div
                      className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${disp.color}`}
                    >
                      <Icon name={disp.icon} size="text-sm" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-bold text-on-surface leading-tight">
                        {disp.label}
                      </p>
                    </div>
                    {selectedDisposition === disp.type && (
                      <div className="absolute top-1 right-1">
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
              placeholder="Any important details from the call..."
              className="w-full border border-outline-variant/30 rounded-lg px-3 py-2 text-sm min-h-[80px] focus:outline-none focus:ring-2 focus:ring-primary/20 bg-surface-container"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 bg-surface-container-high border-t border-outline-variant/10 flex items-center justify-between gap-4">
          <p className="text-xs text-on-surface-variant italic">
            Cannot proceed without logging call outcome
          </p>
          <button
            onClick={handleSubmit}
            disabled={!selectedDisposition || submitting}
            className="px-6 py-2.5 bg-primary text-on-primary font-bold rounded-lg hover:opacity-90 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? 'Logging...' : 'Log & Continue'}
          </button>
        </div>
      </div>
    </div>
  )
}
