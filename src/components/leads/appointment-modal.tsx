'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'

interface AppointmentModalProps {
  lead: {
    id: string
    full_name: string | null
    phone: string | null
    property_address: string | null
  }
  initialAppointment?: {
    type?: string | null
    scheduledAt?: string | null
    assignedTo?: string | null
    notes?: string | null
  } | null
  onClose: () => void
  onSuccess: () => void
}

function appointmentToInputs(initialAppointment: AppointmentModalProps['initialAppointment']) {
  if (!initialAppointment?.scheduledAt) return { date: '', time: '10:00' }
  const d = new Date(initialAppointment.scheduledAt)
  if (isNaN(d.getTime())) return { date: '', time: '10:00' }
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` }
}

function agentLabel(value: string | null | undefined) {
  const normalized = (value || '').toLowerCase()
  if (normalized.includes('casey')) return 'Casey Davis'
  return 'Ernest Dodson'
}

export function AppointmentModal({ lead, initialAppointment, onClose, onSuccess }: AppointmentModalProps) {
  const initialInputs = appointmentToInputs(initialAppointment)
  const [form, setForm] = useState({
    type: initialAppointment?.type || 'in_person',
    date: initialInputs.date,
    time: initialInputs.time,
    agent: agentLabel(initialAppointment?.assignedTo),
    notes: initialAppointment?.notes || '',
    sendReminder: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const typeOptions = [
    { value: 'in_person', label: 'In-Person Visit', icon: 'home' },
    { value: 'phone_call', label: 'Phone Call', icon: 'call' },
    { value: 'google_meet', label: 'Google Meet', icon: 'videocam' },
  ]

  async function handleSubmit() {
    if (!form.date || !form.time) return
    setSaving(true)
    setError(null)

    const appointmentDate = new Date(`${form.date}T${form.time}:00`).toISOString()
    const assignedTo = form.agent.toLowerCase().includes('casey') ? 'casey' : 'ernest'

    try {
      // Server-side appointment creation (bypasses RLS on manifests table)
      const res = await fetch('/api/leads/create-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          type: form.type,
          scheduledAt: appointmentDate,
          assignedTo,
          notes: form.notes || null,
          sendReminder: form.sendReminder,
        }),
      })

      if (!res.ok) {
        const payload = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(payload.error || 'Appointment could not be saved')
      }

      onSuccess()
      onClose()
    } catch (error) {
      console.error('Failed to create appointment:', error)
      setError(error instanceof Error ? error.message : 'Appointment could not be saved')
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="ck-dark bg-surface-container-lowest rounded-2xl shadow-2xl max-w-md w-full border border-outline-variant/20">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[color:var(--ck-border)]">
            <div className="flex items-center gap-2">
              <Icon name="calendar_month" className="text-primary" />
              <h2 className="text-lg font-bold text-white">{initialAppointment?.scheduledAt ? 'Edit Appointment' : 'Schedule Appointment'}</h2>
            </div>
            <button type="button" aria-label="Close appointment" onClick={onClose} className="text-[color:var(--ck-text-dim)] hover:text-[color:var(--ck-text-muted)] transition-colors">
              <Icon name="close" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Appointment Type */}
            <div>
              <label className="block text-xs font-bold text-[color:var(--ck-text-muted)] uppercase mb-2">Type</label>
              <div className="flex gap-2">
                {typeOptions.map(opt => (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setForm(f => ({ ...f, type: opt.value }))}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      form.type === opt.value
                        ? 'bg-primary text-white border-primary'
                        : 'bg-[color:var(--ck-surface-elev)] text-[color:var(--ck-text-muted)] border-[color:var(--ck-border)] hover:bg-[color:var(--ck-surface-hi)]'
                    }`}
                  >
                    <Icon name={opt.icon} size="text-sm" />
                    <span className="hidden sm:inline">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Date & Time */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="appointment-date" className="block text-xs font-bold text-[color:var(--ck-text-muted)] uppercase mb-1">Date</label>
                <input
                  id="appointment-date"
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full border border-[color:var(--ck-border)] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
              <div>
                <label htmlFor="appointment-time" className="block text-xs font-bold text-[color:var(--ck-text-muted)] uppercase mb-1">Time</label>
                <input
                  id="appointment-time"
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm(f => ({ ...f, time: e.target.value }))}
                  className="w-full border border-[color:var(--ck-border)] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
            </div>

            {/* Agent */}
            <div>
              <label htmlFor="appointment-agent" className="block text-xs font-bold text-[color:var(--ck-text-muted)] uppercase mb-1">Agent</label>
              <select
                id="appointment-agent"
                value={form.agent}
                onChange={(e) => setForm(f => ({ ...f, agent: e.target.value }))}
                className="w-full border border-[color:var(--ck-border)] rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
              >
                <option value="Ernest Dodson">Ernest Dodson</option>
                <option value="Casey Davis">Casey Davis</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label htmlFor="appointment-notes" className="block text-xs font-bold text-[color:var(--ck-text-muted)] uppercase mb-1">Notes (optional)</label>
              <textarea
                id="appointment-notes"
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional details..."
                rows={2}
                className="w-full border border-[color:var(--ck-border)] rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>

            {/* Send Reminder */}
            <label className="flex items-center gap-2 text-sm cursor-pointer bg-[color:var(--ck-surface-elev)] rounded-lg p-3">
              <input
                type="checkbox"
                checked={form.sendReminder}
                onChange={(e) => setForm(f => ({ ...f, sendReminder: e.target.checked }))}
                className="rounded border-[color:var(--ck-border)] text-primary focus:ring-primary"
              />
              <span className="text-[color:var(--ck-text)]">Send SMS confirmation to seller</span>
            </label>
            {error && <p role="alert" className="rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">{error}</p>}
          </div>

          <div className="px-6 py-4 border-t border-[color:var(--ck-border)] flex gap-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-[color:var(--ck-border)] rounded-lg py-2.5 text-sm font-bold text-[color:var(--ck-text-muted)] hover:bg-[color:var(--ck-surface-hi)] transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || !form.date}
              className="flex-1 bg-primary text-white rounded-lg py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {saving ? 'Saving...' : initialAppointment?.scheduledAt ? 'Save Appointment' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
