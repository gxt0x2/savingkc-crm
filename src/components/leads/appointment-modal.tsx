'use client'

import { useEffect, useState } from 'react'
import { appointmentAgentChoices, appointmentAgentValue } from '@/components/leads/appointment-agents'
import { DeleteAppointmentButton } from '@/components/leads/delete-appointment-button'
import { Icon } from '@/components/ui/icon'
import { useAuth } from '@/hooks/use-auth'

interface AppointmentModalProps {
  lead: {
    id: string
    full_name: string | null
    phone: string | null
    property_address: string | null
  }
  initialAppointment?: {
    appointmentId?: string | null
    type?: string | null
    scheduledAt?: string | null
    assignedTo?: string | null
    notes?: string | null
  } | null
  onClose: () => void
  onSuccess: () => void
  actorName?: string | null
}

function appointmentToInputs(initialAppointment: AppointmentModalProps['initialAppointment']) {
  if (!initialAppointment?.scheduledAt) return { date: '', time: '10:00' }
  const d = new Date(initialAppointment.scheduledAt)
  if (isNaN(d.getTime())) return { date: '', time: '10:00' }
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(d)
  const value = (name: string) => parts.find(p => p.type === name)?.value || ''
  const yyyy = value('year'), mm = value('month'), dd = value('day'), hh = value('hour'), mi = value('minute')
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${mi}` }
}

function profileActorName(profile: { full_name?: unknown; email?: unknown } | null | undefined): string | null {
  if (typeof profile?.full_name === 'string' && profile.full_name.trim()) return profile.full_name.trim()
  if (typeof profile?.email === 'string' && profile.email.trim()) return profile.email.trim()
  return null
}

export function AppointmentModal({ lead, initialAppointment, onClose, onSuccess, actorName: actorNameProp }: AppointmentModalProps) {
  const { user } = useAuth()
  const initialInputs = appointmentToInputs(initialAppointment)
  const [actorName, setActorName] = useState<string | null>(actorNameProp?.trim() || null)
  const [agentTouched, setAgentTouched] = useState(Boolean(initialAppointment?.assignedTo))
  const [form, setForm] = useState({
    type: initialAppointment?.type || 'in_person',
    date: initialInputs.date,
    time: initialInputs.time,
    agent: appointmentAgentValue(actorNameProp, initialAppointment?.assignedTo),
    notes: initialAppointment?.notes || '',
    sendReminder: true,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const agentChoices = appointmentAgentChoices(actorName)

  useEffect(() => {
    if (actorNameProp?.trim()) {
      setActorName(actorNameProp.trim())
      return
    }
    const sessionEmail = user?.email?.trim() || ''
    let cancelled = false
    fetch('/api/settings')
      .then(async (response) => response.ok ? response.json() : null)
      .then((data: { profile?: { full_name?: unknown; email?: unknown } | null } | null) => {
        if (cancelled || !data) return
        const fromProfile = profileActorName(data.profile)
        setActorName(fromProfile || (data.profile === null ? sessionEmail || null : null))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [actorNameProp, user?.email])

  useEffect(() => {
    if (agentTouched) return
    setForm((current) => ({ ...current, agent: appointmentAgentValue(actorName, initialAppointment?.assignedTo) }))
  }, [actorName, agentTouched, initialAppointment?.assignedTo])

  const typeOptions = [
    { value: 'in_person', label: 'In-Person Visit', icon: 'home' },
    { value: 'phone_call', label: 'Phone Call', icon: 'call' },
    { value: 'google_meet', label: 'Google Meet', icon: 'videocam' },
  ]

  async function handleSubmit() {
    if (!form.date || !form.time) return
    setSaving(true)
    setError(null)

    const reference = new Date(`${form.date}T12:00:00Z`)
    const zone = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'longOffset' }).formatToParts(reference).find(p => p.type === 'timeZoneName')?.value
    const offset = zone?.match(/^GMT([+-]\d{2}:\d{2})$/)?.[1]
    if (!offset) { setSaving(false); setError('Central time could not be determined'); return }
    const appointmentDate = new Date(`${form.date}T${form.time}:00${offset}`).toISOString()
    const assignedTo = form.agent

    try {
      // Server-side appointment creation (bypasses RLS on manifests table)
      const res = await fetch('/api/leads/create-appointment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          leadId: lead.id,
          appointmentId: initialAppointment?.appointmentId || undefined,
          type: form.type,
          scheduledAt: appointmentDate,
          assignedTo,
          notes: form.notes || null,
          sendReminder: form.sendReminder,
        }),
      })

      const payload = await res.json().catch(() => ({})) as { error?: string; warning?: string }
      if (!res.ok) {
        throw new Error(payload.error || 'Appointment could not be saved')
      }

      onSuccess()
      if (payload.warning) {
        setError(payload.warning)
        return
      }
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
        <div className="crm-modal-surface w-full max-w-md rounded-2xl border border-[color:var(--ck-border)] bg-[color:var(--ck-surface)] shadow-2xl">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[color:var(--ck-border)]">
            <div className="flex items-center gap-2">
              <Icon name="calendar_month" className="text-[color:var(--ck-accent)]" />
              <h2 className="text-lg font-bold text-[color:var(--ck-text)]">{initialAppointment?.scheduledAt ? 'Edit Appointment' : 'Schedule Appointment'}</h2>
            </div>
            <button type="button" aria-label="Close appointment" onClick={onClose} className="text-[color:var(--ck-text-dim)] hover:text-[color:var(--ck-text)] transition-colors">
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
                        ? 'border-[color:var(--ck-accent)] bg-[color:var(--ck-accent)] text-white hover:bg-[color:var(--ck-accent-bright)]'
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
                  className="w-full rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface-elev)] px-3 py-2 text-sm text-[color:var(--ck-text)] focus:border-[color:var(--ck-accent)] focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
              </div>
              <div>
                <label htmlFor="appointment-time" className="block text-xs font-bold text-[color:var(--ck-text-muted)] uppercase mb-1">Time</label>
                <input
                  id="appointment-time"
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm(f => ({ ...f, time: e.target.value }))}
                  className="w-full rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface-elev)] px-3 py-2 text-sm text-[color:var(--ck-text)] focus:border-[color:var(--ck-accent)] focus:outline-none focus:ring-2 focus:ring-red-500/20"
                />
              </div>
            </div>

            {/* Agent */}
            <div>
              <label htmlFor="appointment-agent" className="block text-xs font-bold text-[color:var(--ck-text-muted)] uppercase mb-1">Agent</label>
              <select
                id="appointment-agent"
                aria-describedby="appointment-agent-calendar"
                value={form.agent}
                onChange={(e) => {
                  setAgentTouched(true)
                  setForm(f => ({ ...f, agent: e.target.value }))
                }}
                className="w-full rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface-elev)] px-3 py-2 text-sm text-[color:var(--ck-text)] focus:border-[color:var(--ck-accent)] focus:outline-none focus:ring-2 focus:ring-red-500/20"
              >
                {agentChoices.map((choice) => (
                  <option key={choice.value} value={choice.value}>{choice.label}</option>
                ))}
              </select>
              <p id="appointment-agent-calendar" className="mt-1 text-[11px] text-[color:var(--ck-text-muted)]">
                Google Calendar uses the Google account connected to your login.
              </p>
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
                className="w-full resize-none rounded-lg border border-[color:var(--ck-border)] bg-[color:var(--ck-surface-elev)] px-3 py-2 text-sm text-[color:var(--ck-text)] placeholder:text-[color:var(--ck-text-dim)] focus:border-[color:var(--ck-accent)] focus:outline-none focus:ring-2 focus:ring-red-500/20"
              />
            </div>

            {/* Send Reminder */}
            <label className="flex items-center gap-2 text-sm cursor-pointer bg-[color:var(--ck-surface-elev)] rounded-lg p-3">
              <input
                type="checkbox"
                checked={form.sendReminder}
                onChange={(e) => setForm(f => ({ ...f, sendReminder: e.target.checked }))}
                className="rounded border-[color:var(--ck-border)] focus:ring-2 focus:ring-red-500/20"
                style={{ accentColor: 'var(--ck-accent)' }}
              />
              <span className="text-[color:var(--ck-text)]">Send booking SMS + email and appointment reminders</span>
            </label>
            {error && (
              <p
                role="alert"
                className="rounded-lg border px-3 py-2 text-sm"
                style={{
                  borderColor: 'var(--crm-danger-border)',
                  background: 'var(--crm-danger-soft)',
                  color: 'var(--crm-danger)',
                }}
              >
                {error}
              </p>
            )}
          </div>

          <div className="px-6 py-4 border-t border-[color:var(--ck-border)] flex items-center gap-3">
            {initialAppointment?.appointmentId || initialAppointment?.scheduledAt ? (
              <DeleteAppointmentButton
                leadId={lead.id}
                appointmentId={initialAppointment.appointmentId}
                scheduledAt={initialAppointment.scheduledAt}
                onDeleted={() => {
                  onSuccess()
                  onClose()
                }}
                className="text-sm font-bold text-[color:var(--crm-danger)]"
              />
            ) : null}
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
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-[color:var(--ck-accent)] py-2.5 text-sm font-bold text-white transition-colors hover:bg-[color:var(--ck-accent-bright)] disabled:opacity-50"
            >
              {saving ? 'Saving...' : initialAppointment?.scheduledAt ? 'Save Appointment' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
