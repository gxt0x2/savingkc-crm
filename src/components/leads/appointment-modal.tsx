'use client'

import { useState } from 'react'
import { Icon } from '@/components/ui/icon'
import { createClient } from '@/lib/supabase/client'
import { toProperCase } from '@/lib/format'

interface AppointmentModalProps {
  lead: {
    id: string
    full_name: string | null
    phone: string | null
    property_address: string | null
  }
  onClose: () => void
  onSuccess: () => void
}

export function AppointmentModal({ lead, onClose, onSuccess }: AppointmentModalProps) {
  const [form, setForm] = useState({
    type: 'in_person',
    date: '',
    time: '10:00',
    agent: 'Ernest Dodson',
    notes: '',
    sendReminder: true,
  })
  const [saving, setSaving] = useState(false)

  const typeOptions = [
    { value: 'in_person', label: 'In-Person Visit', icon: 'home' },
    { value: 'phone_call', label: 'Phone Call', icon: 'call' },
    { value: 'google_meet', label: 'Google Meet', icon: 'videocam' },
  ]

  async function handleSubmit() {
    if (!form.date || !form.time) return
    setSaving(true)

    const appointmentDate = `${form.date}T${form.time}:00`
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
          address: form.type === 'in_person' ? (lead.property_address || null) : null,
          notes: form.notes || null,
          sendReminder: form.sendReminder,
          phone: lead.phone,
          leadName: toProperCase(lead.full_name),
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        console.error('Appointment creation failed:', err)
      }

      setSaving(false)
      onSuccess()
      onClose()
    } catch (error) {
      console.error('Failed to create appointment:', error)
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full">
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Icon name="calendar_month" className="text-primary" />
              <h2 className="text-lg font-bold text-gray-900">Schedule Appointment</h2>
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600 transition-colors">
              <Icon name="close" />
            </button>
          </div>

          <div className="px-6 py-5 space-y-4">
            {/* Appointment Type */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">Type</label>
              <div className="flex gap-2">
                {typeOptions.map(opt => (
                  <button
                    key={opt.value}
                    onClick={() => setForm(f => ({ ...f, type: opt.value }))}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-lg text-sm font-medium border transition-all ${
                      form.type === opt.value
                        ? 'bg-primary text-white border-primary'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
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
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Date</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm(f => ({ ...f, date: e.target.value }))}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Time</label>
                <input
                  type="time"
                  value={form.time}
                  onChange={(e) => setForm(f => ({ ...f, time: e.target.value }))}
                  className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
                />
              </div>
            </div>

            {/* Agent */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Agent</label>
              <select
                value={form.agent}
                onChange={(e) => setForm(f => ({ ...f, agent: e.target.value }))}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-primary/20 focus:outline-none"
              >
                <option value="Ernest Dodson">Ernest Dodson</option>
                <option value="Casey Davis">Casey Davis</option>
              </select>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-xs font-bold text-gray-500 uppercase mb-1">Notes (optional)</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
                placeholder="Any additional details..."
                rows={2}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:ring-2 focus:ring-primary/20 focus:outline-none"
              />
            </div>

            {/* Send Reminder */}
            <label className="flex items-center gap-2 text-sm cursor-pointer bg-blue-50 rounded-lg p-3">
              <input
                type="checkbox"
                checked={form.sendReminder}
                onChange={(e) => setForm(f => ({ ...f, sendReminder: e.target.checked }))}
                className="rounded border-gray-300 text-primary focus:ring-primary"
              />
              <span className="text-gray-700">Send SMS confirmation to seller</span>
            </label>
          </div>

          <div className="px-6 py-4 border-t border-gray-100 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 border border-gray-200 rounded-lg py-2.5 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving || !form.date}
              className="flex-1 bg-primary text-white rounded-lg py-2.5 text-sm font-bold hover:opacity-90 disabled:opacity-50 transition-all flex items-center justify-center gap-2"
            >
              {saving ? 'Scheduling...' : 'Schedule'}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}
